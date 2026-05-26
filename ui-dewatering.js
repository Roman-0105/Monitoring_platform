// ── Карьерный водоотлив v2 ───────────────────────────────────

var DewateringState = {
  sumps:                [],  // {id, name, quarry, notes}
  sumpElevationHistory: [],  // {id, sumpId, date, elevation, notes}
  pumps:                [],  // {id, sumpId, name, model, serialNumber, inventoryNumber, quarry, capacity, head, type, status, installDate, notes}
  pumpEvents:           [],  // {id, sumpId, date, type, removedPumpId, installedPumpId, reason, performedBy, notes}
  destinations:         [],  // {id, name, type, targetSumpId}
  meterReadings:        [],  // {id, pumpId, date, reading, isReset, isStopped, downtimeReason, hoursWorked, distributions:[{destinationId,pct}], isManualVolume, manualVolume, notes}
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
      // Migrate old destinationId → distributions:[{destinationId, pct:100}]
      var needSave = false;
      this.meterReadings = this.meterReadings.map(function(r) {
        if (r.destinationId && !r.distributions) {
          var m = Object.assign({}, r, { distributions: [{destinationId: r.destinationId, pct: 100}] });
          delete m.destinationId;
          needSave = true;
          return m;
        }
        return r;
      });
      if (needSave) this.save();
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

  loadFromSupabase: async function() {
    if (!window.Api) return false;
    try {
      var results = await Promise.all([
        Api.getDewSumps(), Api.getDewElevations(), Api.getDewPumps(),
        Api.getDewPumpEvents(), Api.getDewDestinations(),
        Api.getDewReadings(), Api.getDewWaterLevels()
      ]);
      if (results.some(function(r) { return r.error; })) return false;
      this.sumps                = results[0].data.map(rowToDewSump);
      this.sumpElevationHistory = results[1].data.map(rowToDewElev);
      this.pumps                = results[2].data.map(rowToDewPump);
      this.pumpEvents           = results[3].data.map(rowToDewEvt);
      this.destinations         = results[4].data.length ? results[4].data.map(rowToDewDest) : _dewDefaultDest();
      this.meterReadings        = results[5].data.map(rowToDewReading);
      this.waterLevels          = results[6].data.map(rowToDewLevel);
      this.save();
      return true;
    } catch(e) { return false; }
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

  // Last record before `date` that has an actual meter reading (not stopped, not reset).
  // Used so that days when the pump was stopped don't break the diff calculation.
  lastActualReading: function(pumpId, date) {
    var candidates = this.meterReadings
      .filter(function(r) {
        return r.pumpId === pumpId && r.date < date && !r.isStopped && !r.isReset && r.reading != null;
      })
      .sort(function(a, b) { return b.date.localeCompare(a.date); });
    return candidates.length ? candidates[0] : null;
  },

  getDistributions: function(rec) {
    if (rec.distributions && rec.distributions.length) return rec.distributions;
    if (rec.destinationId) return [{ destinationId: rec.destinationId, pct: 100 }];
    return [];
  },

  computedVolume: function(rec) {
    if (!rec) return null;
    if (rec.isStopped) return 0;
    if (rec.isManualVolume) return parseFloat(rec.manualVolume) || 0;
    if (rec.isReset) return 0;
    var prev = this.lastActualReading(rec.pumpId, rec.date);
    if (!prev) return null;
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
  addSump: function(d) {
    d.id = this._id('smp'); this.sumps.push(d); this.save();
    if (window.Api) Api.upsertDewSump(dewSumpToRow(d)).catch(function() {});
    return d;
  },
  updateSump: function(id, d) {
    var i = this.sumps.findIndex(function(s){return s.id===id;});
    if(i>=0){ this.sumps[i]=Object.assign({},this.sumps[i],d); this.save();
      if (window.Api) Api.upsertDewSump(dewSumpToRow(this.sumps[i])).catch(function() {}); }
  },
  deleteSump: function(id) {
    var pIds = this.pumps.filter(function(p){return p.sumpId===id;}).map(function(p){return p.id;});
    this.sumps=[...this.sumps.filter(function(s){return s.id!==id;})];
    this.sumpElevationHistory=this.sumpElevationHistory.filter(function(h){return h.sumpId!==id;});
    this.pumps=this.pumps.filter(function(p){return p.sumpId!==id;});
    this.pumpEvents=this.pumpEvents.filter(function(e){return e.sumpId!==id;});
    this.meterReadings=this.meterReadings.filter(function(r){return pIds.indexOf(r.pumpId)<0;});
    this.waterLevels=this.waterLevels.filter(function(w){return w.sumpId!==id;});
    this.save();
    if (window.Api) Api.deleteDewSump(id).catch(function() {});
  },

  addElevation: function(d) {
    d.id=this._id('elv'); this.sumpElevationHistory.push(d); this.save();
    if (window.Api) Api.upsertDewElev(dewElevToRow(d)).catch(function() {});
    return d;
  },
  deleteElevation: function(id) {
    this.sumpElevationHistory=this.sumpElevationHistory.filter(function(h){return h.id!==id;}); this.save();
    if (window.Api) Api.deleteDewElev(id).catch(function() {});
  },

  addPump: function(d) {
    d.id=this._id('pmp'); this.pumps.push(d); this.save();
    if (window.Api) Api.upsertDewPump(dewPumpToRow(d)).catch(function() {});
    return d;
  },
  updatePump: function(id, d) {
    var i=this.pumps.findIndex(function(p){return p.id===id;});
    if(i>=0){ this.pumps[i]=Object.assign({},this.pumps[i],d); this.save();
      if (window.Api) Api.upsertDewPump(dewPumpToRow(this.pumps[i])).catch(function() {}); }
  },
  deletePump: function(id) {
    this.pumps=this.pumps.filter(function(p){return p.id!==id;}); this.meterReadings=this.meterReadings.filter(function(r){return r.pumpId!==id;}); this.save();
    if (window.Api) Api.deleteDewPump(id).catch(function() {});
  },

  addPumpEvent: function(d) {
    d.id=this._id('evt'); this.pumpEvents.push(d); this.save();
    if (window.Api) Api.upsertDewPumpEvent(dewEvtToRow(d)).catch(function() {});
    return d;
  },
  deletePumpEvent: function(id) {
    this.pumpEvents=this.pumpEvents.filter(function(e){return e.id!==id;}); this.save();
    if (window.Api) Api.deleteDewPumpEvent(id).catch(function() {});
  },

  addDest: function(d) {
    d.id=this._id('dst'); this.destinations.push(d); this.save();
    if (window.Api) Api.upsertDewDest(dewDestToRow(d)).catch(function() {});
    return d;
  },
  deleteDest: function(id) {
    this.destinations=this.destinations.filter(function(d){return d.id!==id;}); this.save();
    if (window.Api) Api.deleteDewDest(id).catch(function() {});
  },

  addReading: function(d) {
    d.id=this._id('mrd'); this.meterReadings.push(d); this.save();
    if (window.Api) Api.upsertDewReading(dewReadingToRow(d)).catch(function() {});
    return d;
  },
  updateReading: function(id, d) {
    var i=this.meterReadings.findIndex(function(r){return r.id===id;});
    if(i>=0){ this.meterReadings[i]=Object.assign({},this.meterReadings[i],d); this.save();
      if (window.Api) Api.upsertDewReading(dewReadingToRow(this.meterReadings[i])).catch(function() {}); }
  },
  deleteReading: function(id) {
    this.meterReadings=this.meterReadings.filter(function(r){return r.id!==id;}); this.save();
    if (window.Api) Api.deleteDewReading(id).catch(function() {});
  },

  addWaterLevel: function(d) {
    d.id=this._id('wlv'); this.waterLevels.push(d); this.save();
    if (window.Api) Api.upsertDewLevel(dewLevelToRow(d)).catch(function() {});
    return d;
  },
  updateWaterLevel: function(id, d) {
    var i=this.waterLevels.findIndex(function(w){return w.id===id;});
    if(i>=0){ this.waterLevels[i]=Object.assign({},this.waterLevels[i],d); this.save();
      if (window.Api) Api.upsertDewLevel(dewLevelToRow(this.waterLevels[i])).catch(function() {}); }
  },
  deleteWaterLevel: function(id) {
    this.waterLevels=this.waterLevels.filter(function(w){return w.id!==id;}); this.save();
    if (window.Api) Api.deleteDewLevel(id).catch(function() {});
  },
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

var _dewInited          = false;
var _dewSubTab          = 'overview';
var _dewJFilter         = { quarry: '', sumpId: '', date: '' };
var _dewLFilter         = { quarry: '', sumpId: '' };
var _dewAFilter         = { quarry: '', sumpId: '' };
var _dewShowPumpRegistry = false;
var _dewEditReadingId    = null;
var _dewEditLevelId      = null;
var _dewDiagramPos       = {};
var _dewDiagramDrag      = null;
var _dewDiagramFlows     = {};
var DEW_DN               = { sumpW: 200, sumpH: 110, pumpW: 155, pumpH: 70, destW: 180, destH: 82 };
var _dewPumpsCollapsed   = true;
var _dewDestsCollapsed   = true;
var _dewDiagramDatePreset = 'yesterday'; // 'yesterday' | '7d' | '2w' | '1m' | 'custom'
var _dewDiagramDateFrom   = '';
var _dewDiagramDateTo     = '';

// ── Init ─────────────────────────────────────────────────────

function initDewateringTab() {
  DewateringState.load(); // immediate localStorage
  if (!_dewInited) {
    _dewInited = true;
    document.querySelectorAll('[data-dew-tab]').forEach(function(btn) {
      btn.addEventListener('click', function() { _dewSwitch(this.dataset.dewTab); });
    });
    // Async Supabase load — re-render when done
    DewateringState.loadFromSupabase().then(function(ok) {
      if (ok) _dewSwitch(_dewSubTab);
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

var DEW_FILL_STATUS = {
  complete: { icon: '✓', clr: 'var(--ok)',   label: 'Журнал заполнен' },
  partial:  { icon: '◑', clr: 'var(--warn)', label: 'Частично заполнен' },
  empty:    { icon: '✗', clr: 'var(--bad)',  label: 'Не заполнен' },
  noactive: { icon: '—', clr: 'var(--txt-3)',label: 'Нет активных насосов' },
};

function _dewRenderOverview() {
  var el = document.getElementById('dew-panel-overview');
  if (!el) return;

  var today      = new Date().toISOString().slice(0, 10);
  var yesterday  = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  var monthStart = yesterday.slice(0, 7) + '-01';
  var allPumps   = DewateringState.pumps;
  var working    = allPumps.filter(function(p) { return p.status === 'working'; }).length;
  var standby    = allPumps.filter(function(p) { return p.status === 'standby'; }).length;
  var repair     = allPumps.filter(function(p) { return p.status === 'repair';  }).length;

  var volMonth = DewateringState.meterReadings
    .filter(function(r) { return r.date >= monthStart && r.date <= yesterday && _dewPumpCounts(r.pumpId); })
    .reduce(function(a, r) { return a + (DewateringState.computedVolume(r) || 0); }, 0);
  var volYest = DewateringState.meterReadings
    .filter(function(r) { return r.date === yesterday && _dewPumpCounts(r.pumpId); })
    .reduce(function(a, r) { return a + (DewateringState.computedVolume(r) || 0); }, 0);
  var hasExcluded = DewateringState.pumps.some(function(p) { return p.countInVolume === false; });
  var nowRu = new Date().toLocaleString('ru', { month: 'long' });

  var kpiHtml =
    '<div class="anl-kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">' +
    _dewKpi('Зумпфов в карьере',  DewateringState.sumps.length, allPumps.length + ' насосов', 'var(--gold)') +
    _dewKpi('Работают сейчас',    working, standby + ' рез. · ' + repair + ' рем.', 'var(--ok)') +
    _dewKpi('Объём за вчера',     volYest.toFixed(0) + ' <small>м³</small>', yesterday + (hasExcluded ? ' · без промежут.' : ''), 'var(--blue)') +
    _dewKpi('Объём за месяц',     volMonth.toFixed(0) + ' <small>м³</small>', nowRu + (hasExcluded ? ' · без промежут.' : ''), 'var(--warn)') +
    _dewKpi('Записей журнала',    DewateringState.meterReadings.length, 'всего показаний', 'var(--txt-2)') +
    _dewKpi('Замеров уровня',     DewateringState.waterLevels.length,   'зеркало воды', 'var(--txt-2)') +
    '</div>';

  if (!DewateringState.sumps.length) {
    el.innerHTML = kpiHtml + '<div class="card" style="padding:24px;text-align:center;color:var(--txt-3);font-size:13px">Зумпфы не добавлены — перейдите на вкладку <b>Зумпфы</b></div>';
    return;
  }

  // Group sumps by quarry
  var quarryGroups = {};
  var quarryOrder  = [];
  DewateringState.sumps.forEach(function(s) {
    var q = s.quarry || 'Без карьера';
    if (!quarryGroups[q]) { quarryGroups[q] = []; quarryOrder.push(q); }
    quarryGroups[q].push(s);
  });

  var sumpsHtml = '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--txt-3);margin-bottom:10px">Состояние зумпфов · ' + yesterday + '</div>';

  quarryOrder.forEach(function(quarry) {
    if (quarryOrder.length > 1) {
      sumpsHtml += '<div style="font-size:10px;font-weight:600;letter-spacing:.05em;color:var(--txt-3);text-transform:uppercase;margin-bottom:6px;margin-top:12px;padding-bottom:4px;border-bottom:1px solid var(--line)">' + escHTML(quarry) + '</div>';
    }
    sumpsHtml += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:10px;margin-bottom:8px">';

    quarryGroups[quarry].forEach(function(sump) {
      var pumps       = DewateringState.pumpsOfSump(sump.id);
      var wk          = pumps.filter(function(p) { return p.status === 'working'; }).length;
      var st          = pumps.filter(function(p) { return p.status === 'standby'; }).length;
      var rp          = pumps.filter(function(p) { return p.status === 'repair';  }).length;
      var fillSt      = DewateringState.sumpFillStatus(sump.id, yesterday);
      var fs          = DEW_FILL_STATUS[fillSt];
      var elev        = DewateringState.sumpCurrentElevation(sump.id);
      var latestWL    = DewateringState.waterLevels
        .filter(function(w) { return w.sumpId === sump.id; })
        .sort(function(a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
      var wl    = latestWL.length ? parseFloat(latestWL[0].elevation) : null;
      var depth = (wl != null && elev != null) ? (wl - elev) : null;
      var sumpPumpIds = pumps.map(function(p) { return p.id; });
      var sumpVolToday = DewateringState.meterReadings
        .filter(function(r) { return r.date === yesterday && sumpPumpIds.indexOf(r.pumpId) >= 0; })
        .reduce(function(a, r) { return a + (DewateringState.computedVolume(r) || 0); }, 0);

      // Fill button style depends on status
      var btnStyle = fillSt === 'complete'
        ? 'background:rgba(74,222,128,.12);color:var(--ok);border:1px solid rgba(74,222,128,.3)'
        : fillSt === 'partial'
        ? 'background:rgba(251,191,36,.12);color:var(--warn);border:1px solid rgba(251,191,36,.3)'
        : fillSt === 'noactive'
        ? 'background:var(--bg-1);color:var(--txt-3);border:1px solid var(--line)'
        : 'background:var(--gold);color:#000;border:none';
      var btnLabel = fillSt === 'complete' ? '✓ Редактировать'
                   : fillSt === 'partial'  ? '◑ Дозаполнить'
                   : fillSt === 'noactive' ? '— Нет насосов'
                   : 'Заполнить данные';

      sumpsHtml +=
        '<div class="card" style="padding:14px">' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px">' +
            '<div>' +
              '<div style="font-weight:600;color:var(--txt-1);font-size:13px">' + escHTML(sump.name) + '</div>' +
              (sump.quarry && quarryOrder.length === 1 ? '<div style="font-size:10px;color:var(--txt-3)">' + escHTML(sump.quarry) + '</div>' : '') +
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
          '<div style="display:flex;gap:10px;font-size:11px;color:var(--txt-3);margin-bottom:10px">' +
            '<span>Насосов: <b style="color:var(--txt-1)">' + pumps.length + '</b></span>' +
            (wk ? '<span style="color:var(--ok)">▶ ' + wk + ' раб.</span>' : '') +
            (st ? '<span style="color:var(--gold)">◼ ' + st + ' рез.</span>' : '') +
            (rp ? '<span style="color:var(--warn)">⚠ ' + rp + ' рем.</span>' : '') +
            '<span style="margin-left:auto">∑ <b style="color:var(--txt-1)">' + sumpVolToday.toFixed(0) + ' м³</b></span>' +
          '</div>' +
          (fillSt !== 'noactive' ?
            '<button class="btn btn-sm" style="width:100%;font-size:11px;' + btnStyle + '" onclick="_dewOpenFillModal(\'' + sump.id + '\',\'' + yesterday + '\')">' + btnLabel + '</button>'
            : '<div style="font-size:11px;color:var(--txt-3);text-align:center;padding:4px 0">Нет активных насосов</div>') +
        '</div>';
    });

    sumpsHtml += '</div>';
  });

  el.innerHTML = kpiHtml + sumpsHtml +
    '<div class="card" style="padding:14px;margin-top:16px" id="dew-diagram-wrap"></div>';
  _dewRenderDiagram(document.getElementById('dew-diagram-wrap'));
}

function _dewKpi(label, val, sub, clr) {
  return '<div class="anl-kpi"><div class="anl-kpi-lbl">' + label + '</div>' +
    '<div class="anl-kpi-val" style="color:' + clr + '">' + val + '</div>' +
    (sub ? '<div class="anl-kpi-sub">' + sub + '</div>' : '') + '</div>';
}

// ── Блок-схема водоотлива ────────────────────────────────────

function _dewDiagramLoadPos() {
  try { _dewDiagramPos = JSON.parse(localStorage.getItem('dew_diagram_pos') || '{}'); }
  catch(e) { _dewDiagramPos = {}; }
}

function _dewDiagramSavePos() {
  localStorage.setItem('dew_diagram_pos', JSON.stringify(_dewDiagramPos));
}

function _dewDiagramAutoLayout() {
  var sumps = DewateringState.sumps;
  var dests = DewateringState.destinations;
  var G = 80, vGap = 12, grpGap = 20;

  var relayIds = {};
  dests.forEach(function(d) {
    if (d.type === 'intermediate_sump' && d.targetSumpId) relayIds[d.targetSumpId] = true;
  });

  var srcSumps   = sumps.filter(function(s) { return !relayIds[s.id]; });
  var relaySumps = sumps.filter(function(s) { return !!relayIds[s.id]; });
  var termDests  = dests.filter(function(d) { return !(d.type === 'intermediate_sump' && d.targetSumpId); });
  var hasRelay   = relaySumps.length > 0;

  var cSrcSump = 20;
  var cSrcPump = cSrcSump + DEW_DN.sumpW + G;
  var cRelSump = cSrcPump + DEW_DN.pumpW + G;
  var cRelPump = cRelSump + DEW_DN.sumpW + G;
  var cDest    = hasRelay ? cRelPump + DEW_DN.pumpW + G : cSrcPump + DEW_DN.pumpW + G;

  _dewDiagramPos = {};

  function placeSumpGroup(sump, sumpX, pumpX, startY) {
    var sp    = DewateringState.pumpsOfSump(sump.id);
    var pGrpH = sp.length > 0 ? sp.length * DEW_DN.pumpH + (sp.length - 1) * vGap : 0;
    var grpH  = Math.max(DEW_DN.sumpH, pGrpH);
    _dewDiagramPos['smp_' + sump.id] = { x: sumpX, y: startY + Math.round((grpH - DEW_DN.sumpH) / 2) };
    if (sp.length) {
      var py = startY + Math.round((grpH - pGrpH) / 2);
      sp.forEach(function(p, i) { _dewDiagramPos['pmp_' + p.id] = { x: pumpX, y: py + i * (DEW_DN.pumpH + vGap) }; });
    }
    return startY + grpH + grpGap;
  }

  var y = 20;
  srcSumps.forEach(function(s) { y = placeSumpGroup(s, cSrcSump, cSrcPump, y); });

  var ry = 20;
  if (hasRelay) relaySumps.forEach(function(s) { ry = placeSumpGroup(s, cRelSump, cRelPump, ry); });

  var dy = 20;
  termDests.forEach(function(d) {
    _dewDiagramPos['dst_' + d.id] = { x: cDest, y: dy };
    dy += DEW_DN.destH + vGap;
  });

  // Place nozzle (гусак) nodes from DustState below destination nodes
  if (typeof DustState !== 'undefined' && DustState.nozzles) {
    var sumpIds = {};
    sumps.forEach(function(s) { sumpIds[s.id] = true; });
    var nzlW = 180, nzlH = 70, nzlVGap = 10;
    DustState.nozzles.forEach(function(nzl) {
      if (nzl.sourceType !== 'sump' || !nzl.sourceId || !sumpIds[nzl.sourceId]) return;
      _dewDiagramPos['nzl_' + nzl.id] = { x: cDest, y: dy };
      dy += nzlH + nzlVGap;
    });
  }
}

function _dewDiagramComputeFlows(dateFrom, dateTo) {
  // Returns { 'pumpId→targetNodeId': { pumpId, targetNodeId, volDate, volTotal } }
  // volDate = volume within the dateFrom..dateTo range; volTotal = all time
  var byKey = {};
  DewateringState.meterReadings.forEach(function(r) {
    var vol = DewateringState.computedVolume(r) || 0;
    if (!vol) return;
    DewateringState.getDistributions(r).forEach(function(d) {
      if (!d.destinationId) return;
      var dest = DewateringState.destById(d.destinationId);
      if (!dest) return;
      var targetNodeId = (dest.type === 'intermediate_sump' && dest.targetSumpId)
        ? 'smp_' + dest.targetSumpId
        : 'dst_' + dest.id;
      var key = r.pumpId + '→' + targetNodeId;
      if (!byKey[key]) byKey[key] = { pumpId: r.pumpId, targetNodeId: targetNodeId, volDate: 0, volTotal: 0 };
      var share = vol * d.pct / 100;
      byKey[key].volTotal += share;
      if (dateFrom && dateTo && r.date >= dateFrom && r.date <= dateTo) byKey[key].volDate += share;
      else if (!dateFrom && !dateTo) byKey[key].volDate += share;
    });
  });
  return byKey;
}

function _dewDiagramGetRange() {
  var today = new Date();
  var fmt = function(d) { return d.toISOString().slice(0, 10); };
  var yesterday = fmt(new Date(today.getTime() - 86400000));
  if (_dewDiagramDatePreset === 'yesterday') return { from: yesterday, to: yesterday };
  if (_dewDiagramDatePreset === '7d')  return { from: fmt(new Date(today.getTime() - 7  * 86400000)), to: yesterday };
  if (_dewDiagramDatePreset === '2w')  return { from: fmt(new Date(today.getTime() - 14 * 86400000)), to: yesterday };
  if (_dewDiagramDatePreset === '1m')  return { from: fmt(new Date(today.getTime() - 30 * 86400000)), to: yesterday };
  if (_dewDiagramDatePreset === 'custom') return { from: _dewDiagramDateFrom || yesterday, to: _dewDiagramDateTo || yesterday };
  return { from: yesterday, to: yesterday };
}

function _dewDiagramSetPreset(preset) {
  _dewDiagramDatePreset = preset;
  var wrap = document.getElementById('dew-diagram-wrap');
  if (wrap) _dewRenderDiagram(wrap);
}

function _dewDiagramPeriodLabel() {
  if (_dewDiagramDatePreset === 'yesterday') return 'Вчера';
  if (_dewDiagramDatePreset === '7d')  return '7 дней';
  if (_dewDiagramDatePreset === '2w')  return '2 недели';
  if (_dewDiagramDatePreset === '1m')  return '30 дней';
  if (_dewDiagramDatePreset === 'custom') {
    var r = _dewDiagramGetRange();
    return r.from === r.to ? r.from : r.from + '…' + r.to;
  }
  return 'Период';
}

function _dewPumpCounts(pumpId) {
  var pump = DewateringState.pumpById(pumpId);
  return !pump || pump.countInVolume !== false;
}

function _dewQuarryList() {
  var seen = {}, list = [];
  DewateringState.sumps.forEach(function(s) {
    var q = s.quarry || '';
    if (q && !seen[q]) { seen[q] = 1; list.push(q); }
  });
  return list;
}

function _dewQuarryOpts(selected) {
  return '<option value="">Все карьеры</option>' + _dewQuarryList().map(function(q) {
    return '<option value="' + escHTML(q) + '"' + (selected === q ? ' selected' : '') + '>' + escHTML(q) + '</option>';
  }).join('');
}

function _dewRenderDiagram(wrap) {
  if (!wrap) return;
  _dewDiagramLoadPos();

  var range = _dewDiagramGetRange();
  var dateFrom = range.from, dateTo = range.to;
  var sumps = DewateringState.sumps;
  var pumps = DewateringState.pumps;
  var dests = DewateringState.destinations;
  _dewDiagramFlows = _dewDiagramComputeFlows(dateFrom, dateTo);

  var termDests = dests.filter(function(d) { return !(d.type === 'intermediate_sump' && d.targetSumpId); });

  // Compute nozzle volumes for the selected date range
  var nozzleVolumes = {}; // nozzleId → { volDate, volTotal }
  var diagNozzles   = [];
  if (typeof DustState !== 'undefined' && DustState.nozzles) {
    var _diagSumpIds = {};
    sumps.forEach(function(s) { _diagSumpIds[s.id] = true; });
    DustState.nozzles.forEach(function(nzl) {
      if (nzl.sourceType !== 'sump' || !nzl.sourceId || !_diagSumpIds[nzl.sourceId]) return;
      diagNozzles.push(nzl);
      var logs    = DustState.logs.filter(function(l) { return l.nozzleId === nzl.id; });
      var volDate = logs.filter(function(l) { return l.date >= dateFrom && l.date <= dateTo; })
        .reduce(function(a, l) {
          var v = l.isManualVolume ? (parseFloat(l.manualVolume) || 0)
            : (parseFloat(l.trips) || 0) * (function() {
                var veh = DustState.vehicleById(l.vehicleId);
                return veh ? (parseFloat(veh.capacity) || 0) : 0;
              }());
          return a + v;
        }, 0);
      var volTotal = logs.reduce(function(a, l) {
        var v = l.isManualVolume ? (parseFloat(l.manualVolume) || 0)
          : (parseFloat(l.trips) || 0) * (function() {
              var veh = DustState.vehicleById(l.vehicleId);
              return veh ? (parseFloat(veh.capacity) || 0) : 0;
            }());
        return a + v;
      }, 0);
      nozzleVolumes[nzl.id] = { volDate: volDate, volTotal: volTotal };
    });
  }

  var allKeys = sumps.map(function(s) { return 'smp_' + s.id; })
    .concat(pumps.map(function(p) { return 'pmp_' + p.id; }))
    .concat(termDests.map(function(d) { return 'dst_' + d.id; }))
    .concat(diagNozzles.map(function(n) { return 'nzl_' + n.id; }));

  if (!allKeys.every(function(k) { return _dewDiagramPos[k]; })) _dewDiagramAutoLayout();

  var canvasW = 900, canvasH = 500;
  allKeys.forEach(function(k) {
    var p = _dewDiagramPos[k]; if (!p) return;
    var w, h;
    if      (k.indexOf('smp_') === 0) { w = DEW_DN.sumpW; h = DEW_DN.sumpH; }
    else if (k.indexOf('pmp_') === 0) { w = DEW_DN.pumpW; h = DEW_DN.pumpH; }
    else if (k.indexOf('nzl_') === 0) { w = 180;           h = 70; }
    else                              { w = DEW_DN.destW; h = DEW_DN.destH; }
    canvasW = Math.max(canvasW, p.x + w + 20);
    canvasH = Math.max(canvasH, p.y + h + 20);
  });

  var nodesHtml = '';

  // ── Sump nodes ──
  sumps.forEach(function(sump) {
    var pos = _dewDiagramPos['smp_' + sump.id]; if (!pos) return;
    var pumpIds = DewateringState.pumpsOfSump(sump.id).map(function(p) { return p.id; });
    var volDate  = DewateringState.meterReadings
      .filter(function(r) { return r.date >= dateFrom && r.date <= dateTo && pumpIds.indexOf(r.pumpId) >= 0; })
      .reduce(function(a, r) { return a + (DewateringState.computedVolume(r) || 0); }, 0);
    var volTotal = pumpIds.reduce(function(a, pid) { return a + DewateringState.totalVolumePump(pid); }, 0);
    var latestWL = DewateringState.waterLevels
      .filter(function(w) { return w.sumpId === sump.id; })
      .sort(function(a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
    var wl    = latestWL.length ? parseFloat(latestWL[0].elevation) : null;
    var elev  = DewateringState.sumpCurrentElevation(sump.id);
    var depth = (wl != null && elev != null) ? (wl - elev) : null;
    var barPct = depth != null ? Math.min(100, Math.max(0, depth / 5 * 100)) : 0;
    var barClr = depth == null ? 'var(--txt-3)' : depth > 2 ? 'var(--bad)' : depth > 1 ? 'var(--warn)' : '#58a6ff';

    nodesHtml +=
      '<div id="dew-dn-smp_' + sump.id + '" class="dew-dn"' +
      ' style="position:absolute;left:' + pos.x + 'px;top:' + pos.y + 'px;width:' + DEW_DN.sumpW + 'px;min-height:' + DEW_DN.sumpH + 'px;' +
      'background:var(--bg-2);border:1px solid rgba(88,166,255,.4);border-radius:var(--r);box-shadow:0 2px 8px rgba(0,0,0,.3);cursor:move;user-select:none;z-index:1;box-sizing:border-box;overflow:hidden"' +
      ' onmousedown="_dewDiagramStartDrag(event,\'smp_' + sump.id + '\')">' +
      '<div style="height:3px;background:rgba(88,166,255,.55)"></div>' +
      '<div style="padding:7px 9px">' +
        '<div style="font-size:11px;font-weight:700;color:var(--txt-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:1px">' + escHTML(sump.name) + '</div>' +
        '<div style="font-size:8px;color:var(--txt-3);margin-bottom:5px">' + (sump.quarry ? escHTML(sump.quarry) : 'зумпф') + '</div>' +
        '<div style="height:4px;background:var(--bg-0);border-radius:2px;overflow:hidden;margin-bottom:5px">' +
          '<div style="height:100%;width:' + barPct + '%;background:' + barClr + ';border-radius:2px"></div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:flex-end">' +
          '<div><div style="font-size:8px;color:var(--txt-3)">' + _dewDiagramPeriodLabel() + '</div><div style="font-size:13px;font-weight:700;color:var(--gold)">' + volDate.toFixed(0) + ' <span style="font-size:8px;font-weight:400">м³</span></div></div>' +
          '<div><div style="font-size:8px;color:var(--txt-3)">Всего</div><div style="font-size:11px;color:var(--txt-2)">' + volTotal.toFixed(0) + ' <span style="font-size:8px">м³</span></div></div>' +
          (depth != null ? '<div style="margin-left:auto"><div style="font-size:8px;color:var(--txt-3)">Глубина</div><div style="font-size:10px;color:' + barClr + '">' + depth.toFixed(1) + ' м</div></div>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  });

  // ── Pump nodes ──
  pumps.forEach(function(pump) {
    var pos = _dewDiagramPos['pmp_' + pump.id]; if (!pos) return;
    var st       = DEW_PUMP_STATUS[pump.status] || DEW_PUMP_STATUS.off;
    var pumpReadings = DewateringState.meterReadings.filter(function(r) { return r.pumpId === pump.id && r.date >= dateFrom && r.date <= dateTo; });
    var volDate  = pumpReadings.reduce(function(a, r) { return a + (DewateringState.computedVolume(r) || 0); }, 0);
    var volTotal = DewateringState.totalVolumePump(pump.id);
    var stClr = pump.status === 'working' ? 'var(--ok)' : pump.status === 'standby' ? '#58a6ff' : pump.status === 'repair' ? 'var(--warn)' : 'var(--txt-3)';

    nodesHtml +=
      '<div id="dew-dn-pmp_' + pump.id + '" class="dew-dn"' +
      ' style="position:absolute;left:' + pos.x + 'px;top:' + pos.y + 'px;width:' + DEW_DN.pumpW + 'px;min-height:' + DEW_DN.pumpH + 'px;' +
      'background:var(--bg-2);border:1px solid rgba(88,166,255,.2);border-radius:var(--r);box-shadow:0 2px 6px rgba(0,0,0,.25);cursor:move;user-select:none;z-index:1;box-sizing:border-box;overflow:hidden"' +
      ' onmousedown="_dewDiagramStartDrag(event,\'pmp_' + pump.id + '\')">' +
      '<div style="height:2px;background:' + stClr + ';opacity:.75"></div>' +
      '<div style="padding:6px 8px">' +
        '<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px">' +
          '<div style="font-size:10px;font-weight:600;color:var(--txt-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">' + escHTML(pump.name) + '</div>' +
          '<span class="anl-pill anl-pill-' + st.cls + '" style="font-size:8px;flex-shrink:0">' + st.label + '</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<div><div style="font-size:8px;color:var(--txt-3)">' + _dewDiagramPeriodLabel() + '</div><div style="font-size:12px;font-weight:700;color:var(--gold)">' + volDate.toFixed(0) + ' <span style="font-size:8px;font-weight:400">м³</span></div></div>' +
          '<div><div style="font-size:8px;color:var(--txt-3)">Всего</div><div style="font-size:10px;color:var(--txt-2)">' + volTotal.toFixed(0) + ' <span style="font-size:8px">м³</span></div></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  });

  // ── Destination nodes (terminal only) ──
  termDests.forEach(function(dest) {
    var pos    = _dewDiagramPos['dst_' + dest.id]; if (!pos) return;
    var dtInfo = DEW_DEST_TYPE[dest.type] || { label: dest.type || 'направление', icon: '📍' };
    var volDate = 0, volTotal = 0;
    Object.keys(_dewDiagramFlows).forEach(function(k) {
      var f = _dewDiagramFlows[k];
      if (f.targetNodeId === 'dst_' + dest.id) { volDate += f.volDate; volTotal += f.volTotal; }
    });

    nodesHtml +=
      '<div id="dew-dn-dst_' + dest.id + '" class="dew-dn"' +
      ' style="position:absolute;left:' + pos.x + 'px;top:' + pos.y + 'px;width:' + DEW_DN.destW + 'px;min-height:' + DEW_DN.destH + 'px;' +
      'background:var(--bg-2);border:1px solid rgba(74,222,128,.35);border-radius:var(--r);box-shadow:0 2px 8px rgba(0,0,0,.3);cursor:move;user-select:none;z-index:1;box-sizing:border-box;overflow:hidden"' +
      ' onmousedown="_dewDiagramStartDrag(event,\'dst_' + dest.id + '\')">' +
      '<div style="height:3px;background:rgba(74,222,128,.5)"></div>' +
      '<div style="padding:7px 9px">' +
        '<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">' +
          '<span style="font-size:12px;line-height:1;flex-shrink:0">' + dtInfo.icon + '</span>' +
          '<div style="font-size:10px;font-weight:700;color:var(--txt-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHTML(dest.name) + '</div>' +
        '</div>' +
        '<div style="font-size:8px;color:var(--txt-3);margin-bottom:5px">' + escHTML(dtInfo.label) + '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<div><div style="font-size:8px;color:var(--txt-3)">' + _dewDiagramPeriodLabel() + '</div><div style="font-size:12px;font-weight:700;color:' + (volDate > 0 ? 'var(--ok)' : 'var(--txt-3)') + '">' + volDate.toFixed(0) + ' <span style="font-size:8px;font-weight:400">м³</span></div></div>' +
          '<div><div style="font-size:8px;color:var(--txt-3)">Всего</div><div style="font-size:10px;color:' + (volTotal > 0 ? 'var(--txt-2)' : 'var(--txt-3)') + '">' + volTotal.toFixed(0) + ' <span style="font-size:8px">м³</span></div></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  });

  // ── Nozzle (гусак) nodes ──
  diagNozzles.forEach(function(nzl) {
    var pos = _dewDiagramPos['nzl_' + nzl.id]; if (!pos) return;
    var nzlW = 180, nzlH = 70;
    var vols   = nozzleVolumes[nzl.id] || { volDate: 0, volTotal: 0 };
    var sumpName = '';
    if (nzl.sourceId && typeof DewateringState !== 'undefined') {
      var srcSump = DewateringState.sumpById(nzl.sourceId);
      if (srcSump) sumpName = srcSump.name;
    }
    nodesHtml +=
      '<div id="dew-dn-nzl_' + nzl.id + '" class="dew-dn"' +
      ' style="position:absolute;left:' + pos.x + 'px;top:' + pos.y + 'px;width:' + nzlW + 'px;min-height:' + nzlH + 'px;' +
      'background:var(--bg-2);border:1px solid rgba(34,211,238,.45);border-radius:var(--r);box-shadow:0 2px 8px rgba(0,0,0,.3);cursor:move;user-select:none;z-index:1;box-sizing:border-box;overflow:hidden"' +
      ' onmousedown="_dewDiagramStartDrag(event,\'nzl_' + nzl.id + '\')">' +
      '<div style="height:3px;background:rgba(34,211,238,.5)"></div>' +
      '<div style="padding:7px 9px">' +
        '<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">' +
          '<span style="font-size:10px;line-height:1;flex-shrink:0">💦</span>' +
          '<div style="font-size:10px;font-weight:700;color:var(--txt-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">гусак</div>' +
        '</div>' +
        '<div style="font-size:9px;color:var(--txt-2);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHTML(nzl.name) + '</div>' +
        (sumpName ? '<div style="font-size:8px;color:var(--txt-3);margin-bottom:4px">⛽ ' + escHTML(sumpName) + '</div>' : '') +
        '<div style="display:flex;gap:8px">' +
          '<div><div style="font-size:8px;color:var(--txt-3)">' + _dewDiagramPeriodLabel() + '</div><div style="font-size:11px;font-weight:700;color:' + (vols.volDate > 0 ? 'rgba(34,211,238,.9)' : 'var(--txt-3)') + '">' + vols.volDate.toFixed(0) + ' <span style="font-size:8px;font-weight:400">м³</span></div></div>' +
          '<div><div style="font-size:8px;color:var(--txt-3)">Всего</div><div style="font-size:10px;color:' + (vols.volTotal > 0 ? 'var(--txt-2)' : 'var(--txt-3)') + '">' + vols.volTotal.toFixed(0) + ' <span style="font-size:8px">м³</span></div></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  });

  var presets = [
    { key: 'yesterday', label: 'Вчера' },
    { key: '7d',  label: '7 дней' },
    { key: '2w',  label: '2 нед' },
    { key: '1m',  label: '1 мес' },
    { key: 'custom', label: 'Период' },
  ];
  var presetBtns = presets.map(function(pr) {
    var active = _dewDiagramDatePreset === pr.key;
    return '<button class="btn btn-sm' + (active ? '' : ' btn-outline') + '" style="font-size:10px;padding:2px 8px' + (active ? ';background:var(--gold);color:#000;border-color:var(--gold)' : '') + '" onclick="_dewDiagramSetPreset(\'' + pr.key + '\')">' + pr.label + '</button>';
  }).join('');
  var customRange = _dewDiagramDatePreset === 'custom'
    ? '<div style="display:flex;gap:6px;align-items:center;margin-top:6px">' +
        '<input type="date" id="dew-diag-from" class="form-control" value="' + escAttr(_dewDiagramDateFrom) + '" style="width:135px;font-size:11px" oninput="_dewDiagramDateFrom=this.value;var w=document.getElementById(\'dew-diagram-wrap\');if(w)_dewRenderDiagram(w)">' +
        '<span style="color:var(--txt-3);font-size:11px">—</span>' +
        '<input type="date" id="dew-diag-to" class="form-control" value="' + escAttr(_dewDiagramDateTo) + '" style="width:135px;font-size:11px" oninput="_dewDiagramDateTo=this.value;var w=document.getElementById(\'dew-diagram-wrap\');if(w)_dewRenderDiagram(w)">' +
      '</div>'
    : '';

  wrap.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">' +
      '<div>' +
        '<div style="display:flex;gap:4px;flex-wrap:wrap">' + presetBtns + '</div>' +
        customRange +
      '</div>' +
      '<button class="btn btn-sm btn-outline" style="font-size:10px" onclick="_dewDiagramReset()">↺ Сбросить позиции</button>' +
    '</div>' +
    '<div style="overflow:auto;border:1px solid var(--line);border-radius:6px;background:var(--bg-0);min-height:520px">' +
      '<div id="dew-diagram-canvas" style="position:relative;width:' + canvasW + 'px;height:' + canvasH + 'px;min-width:900px;min-height:520px">' +
        '<svg id="dew-diagram-svg" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible" xmlns="http://www.w3.org/2000/svg"></svg>' +
        nodesHtml +
      '</div>' +
    '</div>';

  _dewDiagramDrawArrows();
}

function _dewGetAllNodeBoxes() {
  var boxes = [];
  DewateringState.sumps.forEach(function(s) {
    var p = _dewDiagramPos['smp_' + s.id];
    if (p) boxes.push({ id: 'smp_' + s.id, x: p.x, y: p.y, w: DEW_DN.sumpW, h: DEW_DN.sumpH });
  });
  DewateringState.pumps.forEach(function(p) {
    var pos = _dewDiagramPos['pmp_' + p.id];
    if (pos) boxes.push({ id: 'pmp_' + p.id, x: pos.x, y: pos.y, w: DEW_DN.pumpW, h: DEW_DN.pumpH });
  });
  DewateringState.destinations.forEach(function(d) {
    if (!(d.type === 'intermediate_sump' && d.targetSumpId)) {
      var pos = _dewDiagramPos['dst_' + d.id];
      if (pos) boxes.push({ id: 'dst_' + d.id, x: pos.x, y: pos.y, w: DEW_DN.destW, h: DEW_DN.destH });
    }
  });
  if (typeof DustState !== 'undefined' && DustState.nozzles) {
    var _smpIds = {};
    DewateringState.sumps.forEach(function(s) { _smpIds[s.id] = true; });
    DustState.nozzles.forEach(function(nzl) {
      if (nzl.sourceType !== 'sump' || !nzl.sourceId || !_smpIds[nzl.sourceId]) return;
      var pos = _dewDiagramPos['nzl_' + nzl.id];
      if (pos) boxes.push({ id: 'nzl_' + nzl.id, x: pos.x, y: pos.y, w: 180, h: 70 });
    });
  }
  return boxes;
}

function _dewSimplifyPath(pts) {
  if (pts.length < 3) return pts;
  var out = [pts[0]];
  for (var i = 1; i < pts.length - 1; i++) {
    var prev = out[out.length - 1], cur = pts[i], nxt = pts[i + 1];
    var d1x = Math.sign(cur.x - prev.x), d1y = Math.sign(cur.y - prev.y);
    var d2x = Math.sign(nxt.x - cur.x),  d2y = Math.sign(nxt.y - cur.y);
    if (d1x !== d2x || d1y !== d2y) out.push(cur);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function _dewRouteEdge(x1, y1, x2, y2, obstacles) {
  var PAD = 12;

  function segClear(segs) {
    for (var i = 0; i < segs.length - 1; i++) {
      var p1 = segs[i], p2 = segs[i + 1];
      for (var j = 0; j < obstacles.length; j++) {
        var n = obstacles[j];
        var nx1 = n.x - PAD, nx2 = n.x + n.w + PAD;
        var ny1 = n.y - PAD, ny2 = n.y + n.h + PAD;
        if (p1.x === p2.x) {
          var sMinY = Math.min(p1.y, p2.y), sMaxY = Math.max(p1.y, p2.y);
          if (p1.x > nx1 && p1.x < nx2 && sMaxY > ny1 && sMinY < ny2) return false;
        } else {
          var sMinX = Math.min(p1.x, p2.x), sMaxX = Math.max(p1.x, p2.x);
          if (p1.y > ny1 && p1.y < ny2 && sMaxX > nx1 && sMinX < nx2) return false;
        }
      }
    }
    return true;
  }

  var midX = Math.round((x1 + x2) / 2);

  // Candidate vertical x-positions: midpoint + left/right edges of all obstacles
  var candidates = [midX];
  obstacles.forEach(function(n) {
    candidates.push(n.x - PAD - 10);
    candidates.push(n.x + n.w + PAD + 10);
  });
  candidates.sort(function(a, b) { return Math.abs(a - midX) - Math.abs(b - midX); });

  for (var ci = 0; ci < candidates.length; ci++) {
    var mx = candidates[ci];
    var path = [{x:x1,y:y1},{x:mx,y:y1},{x:mx,y:y2},{x:x2,y:y2}];
    if (segClear(path)) return _dewSimplifyPath(path);
  }

  // Fallback: 5-point path routing above/below obstacles
  var allY = [];
  obstacles.forEach(function(n) {
    allY.push(n.y - PAD - 10);
    allY.push(n.y + n.h + PAD + 10);
  });
  allY.sort(function(a, b) { return Math.abs(a - (y1 + y2) / 2) - Math.abs(b - (y1 + y2) / 2); });
  for (var yi = 0; yi < allY.length; yi++) {
    var vy = allY[yi];
    var path5 = [{x:x1,y:y1},{x:midX,y:y1},{x:midX,y:vy},{x:x2,y:vy},{x:x2,y:y2}];
    if (segClear(path5)) return _dewSimplifyPath(path5);
  }

  return _dewSimplifyPath([{x:x1,y:y1},{x:midX,y:y1},{x:midX,y:y2},{x:x2,y:y2}]);
}

function _dewPathToSvg(path, stroke, sw, label, dashArray) {
  if (!path || path.length < 2) return '';
  var d = 'M' + path[0].x + ',' + path[0].y;
  for (var i = 1; i < path.length; i++) d += ' L' + path[i].x + ',' + path[i].y;
  var dashAttr = dashArray ? ' stroke-dasharray="' + dashArray + '"' : '';
  var out = '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + sw + '" stroke-linecap="square" stroke-linejoin="miter"' + dashAttr + '/>';

  var last = path[path.length - 1], prev = path[path.length - 2];
  var ang = Math.atan2(last.y - prev.y, last.x - prev.x);
  var aw = 6;
  var ax1 = (last.x - aw * Math.cos(ang - Math.PI / 6)).toFixed(1);
  var ay1 = (last.y - aw * Math.sin(ang - Math.PI / 6)).toFixed(1);
  var ax2 = (last.x - aw * Math.cos(ang + Math.PI / 6)).toFixed(1);
  var ay2 = (last.y - aw * Math.sin(ang + Math.PI / 6)).toFixed(1);
  out += '<polygon points="' + last.x + ',' + last.y + ' ' + ax1 + ',' + ay1 + ' ' + ax2 + ',' + ay2 + '" fill="' + stroke + '"/>';

  if (label) {
    var lp = path[Math.max(0, path.length - 2)], lq = path[path.length - 1];
    out += '<text x="' + ((lp.x + lq.x) / 2) + '" y="' + ((lp.y + lq.y) / 2 - 7) + '"' +
      ' text-anchor="middle" font-size="9" fill="' + stroke + '" font-family="monospace" font-weight="600">' + label + '</text>';
  }
  return out;
}

function _dewDiagramDrawArrows() {
  var svg = document.getElementById('dew-diagram-svg');
  if (!svg) return;
  var allBoxes = _dewGetAllNodeBoxes();
  var arrows   = '';

  // Sump → Pump structural edges (thin, blue-tinted)
  DewateringState.pumps.forEach(function(pump) {
    var sp = _dewDiagramPos['smp_' + pump.sumpId];
    var pp = _dewDiagramPos['pmp_' + pump.id];
    if (!sp || !pp) return;
    var x1 = sp.x + DEW_DN.sumpW, y1 = sp.y + DEW_DN.sumpH / 2;
    var x2 = pp.x,                y2 = pp.y + DEW_DN.pumpH / 2;
    var obs = allBoxes.filter(function(b) { return b.id !== 'smp_' + pump.sumpId && b.id !== 'pmp_' + pump.id; });
    arrows += _dewPathToSvg(_dewRouteEdge(x1, y1, x2, y2, obs), 'rgba(88,166,255,.3)', 1);
  });

  // Pump → Destination/Sump flow edges (golden, width by volume)
  var maxVol = 0;
  Object.keys(_dewDiagramFlows).forEach(function(k) { var v = _dewDiagramFlows[k].volTotal; if (v > maxVol) maxVol = v; });
  maxVol = maxVol || 1;

  Object.keys(_dewDiagramFlows).forEach(function(key) {
    var f  = _dewDiagramFlows[key];
    var pp = _dewDiagramPos['pmp_' + f.pumpId];
    var tp = _dewDiagramPos[f.targetNodeId];
    if (!pp || !tp) return;
    var x1 = pp.x + DEW_DN.pumpW, y1 = pp.y + DEW_DN.pumpH / 2;
    var tH = f.targetNodeId.indexOf('smp_') === 0 ? DEW_DN.sumpH : DEW_DN.destH;
    var x2 = tp.x, y2 = tp.y + tH / 2;
    var obs = allBoxes.filter(function(b) { return b.id !== 'pmp_' + f.pumpId && b.id !== f.targetNodeId; });
    var sw  = (1.5 + f.volTotal / maxVol * 3.5).toFixed(1);
    var lbl = f.volDate > 0 ? f.volDate.toFixed(0) + ' м³' : '';
    arrows += _dewPathToSvg(_dewRouteEdge(x1, y1, x2, y2, obs), 'rgba(251,191,36,.6)', parseFloat(sw), lbl);
  });

  // Sump → Nozzle dashed teal arrows (dust suppression flows)
  if (typeof DustState !== 'undefined' && DustState.nozzles) {
    var _smpIdsArrow = {};
    DewateringState.sumps.forEach(function(s) { _smpIdsArrow[s.id] = true; });
    DustState.nozzles.forEach(function(nzl) {
      if (nzl.sourceType !== 'sump' || !nzl.sourceId || !_smpIdsArrow[nzl.sourceId]) return;
      var sp  = _dewDiagramPos['smp_' + nzl.sourceId];
      var np  = _dewDiagramPos['nzl_' + nzl.id];
      if (!sp || !np) return;
      var x1  = sp.x + DEW_DN.sumpW / 2;
      var y1  = sp.y + DEW_DN.sumpH;
      var x2  = np.x + 90;
      var y2  = np.y;
      var obs = allBoxes.filter(function(b) { return b.id !== 'smp_' + nzl.sourceId && b.id !== 'nzl_' + nzl.id; });
      // Compute label: volume in selected date range
      var nzlLogs = DustState.logs.filter(function(l) { return l.nozzleId === nzl.id; });
      var volDate  = nzlLogs.filter(function(l) {
        return l.date >= (typeof _dewDiagramGetRange === 'function' ? _dewDiagramGetRange().from : '')
          && l.date <= (typeof _dewDiagramGetRange === 'function' ? _dewDiagramGetRange().to : '');
      }).reduce(function(a, l) {
        var veh = DustState.vehicleById(l.vehicleId);
        var v = l.isManualVolume ? (parseFloat(l.manualVolume) || 0) : (parseFloat(l.trips) || 0) * (veh ? (parseFloat(veh.capacity) || 0) : 0);
        return a + v;
      }, 0);
      var lbl = volDate > 0 ? volDate.toFixed(0) + ' м³' : '';
      // Build a simple straight-ish path (vertical down from sump bottom to nozzle top)
      var path = _dewRouteEdge(x1, y1, x2, y2, obs);
      arrows += _dewPathToSvg(path, 'rgba(34,211,238,.55)', 1.5, lbl, '6,3');
    });
  }

  svg.innerHTML = arrows;
}

function _dewDiagramStartDrag(e, nid) {
  if (e.button !== 0) return;
  e.preventDefault();
  var el = document.getElementById('dew-dn-' + nid);
  if (!el) return;
  var p0  = _dewDiagramPos[nid] || { x: 0, y: 0 };
  var mx0 = e.clientX, my0 = e.clientY;
  var nx0 = p0.x,      ny0 = p0.y;
  _dewDiagramDrag = nid;

  function onMove(ev) {
    var nx = Math.max(0, nx0 + ev.clientX - mx0);
    var ny = Math.max(0, ny0 + ev.clientY - my0);
    _dewDiagramPos[nid] = { x: nx, y: ny };
    el.style.left = nx + 'px';
    el.style.top  = ny + 'px';
    _dewDiagramDrawArrows();
  }
  function onUp() {
    _dewDiagramDrag = null;
    _dewDiagramSavePos();
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
}

function _dewDiagramReset() {
  localStorage.removeItem('dew_diagram_pos');
  _dewDiagramPos = {};
  var wrap = document.getElementById('dew-diagram-wrap');
  if (wrap) _dewRenderDiagram(wrap);
}

// ── Helpers: распределение откачки ──────────────────────────

function _dewAddDistRowWithValue(listId, destId, pct) {
  var list = document.getElementById('dew-dist-' + listId);
  if (!list) return;
  var opts = DewateringState.destinations.map(function(d) {
    return '<option value="' + d.id + '"' + (d.id === destId ? ' selected' : '') + '>' + escHTML(d.name) + '</option>';
  }).join('');
  var row = document.createElement('div');
  row.className = 'dew-dist-row';
  row.style.cssText = 'display:flex;gap:5px;align-items:center;margin-top:4px';
  row.innerHTML =
    '<select class="dew-dist-dest form-control" style="flex:1;font-size:11px" onchange="_dewUpdateDistTotal(\'' + listId + '\')">' +
      '<option value="">— направление —</option>' + opts +
    '</select>' +
    '<input class="dew-dist-pct form-control" type="number" min="0" max="100" value="' + (pct != null ? pct : 100) + '" style="width:62px;font-size:12px;text-align:right" oninput="_dewUpdateDistTotal(\'' + listId + '\')">' +
    '<span style="color:var(--txt-3);font-size:11px;min-width:10px">%</span>' +
    '<button class="btn btn-sm" style="padding:2px 5px;background:rgba(248,113,113,.1);color:var(--bad);border:1px solid rgba(248,113,113,.2);font-size:10px" onclick="this.closest(\'.dew-dist-row\').remove();_dewUpdateDistTotal(\'' + listId + '\')">✕</button>';
  list.appendChild(row);
  _dewUpdateDistTotal(listId);
}

function _dewAddDistRow(listId) { _dewAddDistRowWithValue(listId, '', 100); }

function _dewUpdateDistTotal(listId) {
  var list    = document.getElementById('dew-dist-' + listId);
  var totalEl = document.getElementById('dew-dist-total-' + listId);
  if (!list || !totalEl) return;
  var sum = 0;
  list.querySelectorAll('.dew-dist-pct').forEach(function(i) { sum += parseFloat(i.value) || 0; });
  totalEl.textContent = sum + '%';
  totalEl.style.color = Math.round(sum) === 100 ? 'var(--ok)' : sum > 100 ? 'var(--bad)' : sum === 0 ? 'var(--txt-3)' : 'var(--warn)';
}

function _dewGetDistributions(listId) {
  var list = document.getElementById('dew-dist-' + listId);
  if (!list) return [];
  var result = [];
  list.querySelectorAll('.dew-dist-row').forEach(function(row) {
    var dest = row.querySelector('.dew-dist-dest');
    var pct  = row.querySelector('.dew-dist-pct');
    if (dest && pct && dest.value) result.push({ destinationId: dest.value, pct: parseFloat(pct.value) || 0 });
  });
  return result;
}

function _dewInitDistRows(listId, distributions) {
  var list = document.getElementById('dew-dist-' + listId);
  if (!list) return;
  list.innerHTML = '';
  (distributions || []).forEach(function(d) { _dewAddDistRowWithValue(listId, d.destinationId, d.pct); });
  _dewUpdateDistTotal(listId);
}

function _dewDistBlock(listId) {
  return '<div style="min-width:160px">' +
    '<div style="font-size:9px;color:var(--txt-3);margin-bottom:3px">Распределение откачки</div>' +
    '<div id="dew-dist-' + listId + '"></div>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px">' +
      '<button class="btn btn-sm btn-outline" style="font-size:10px;padding:1px 7px;white-space:nowrap" onclick="_dewAddDistRow(\'' + listId + '\')">+ Направление</button>' +
      '<span style="font-size:10px;color:var(--txt-3);white-space:nowrap">Итого: <span id="dew-dist-total-' + listId + '">—</span></span>' +
    '</div>' +
  '</div>';
}

// ── Модальное окно: ежедневное заполнение ────────────────────

function _dewOpenFillModal(sumpId, date) {
  var sump = DewateringState.sumpById(sumpId);
  if (!sump) return;
  var modalDate = date || new Date().toISOString().slice(0, 10);

  var activePumps = DewateringState.pumpsOfSump(sumpId).filter(function(p) {
    return p.status === 'working' || p.status === 'standby';
  });

  var destOpts = '<option value="">— не указано —</option>' +
    DewateringState.destinations.map(function(d) {
      return '<option value="' + d.id + '">' + escHTML(d.name) + '</option>';
    }).join('');

  // Water level: check if today's level is already recorded
  var existingWL = DewateringState.waterLevels.find(function(w) {
    return w.sumpId === sumpId && w.date === modalDate;
  });
  var bottomElev = DewateringState.sumpCurrentElevation(sumpId);

  // Build pump sections HTML
  var pumpSectionsHtml = activePumps.map(function(p) {
    var existing = DewateringState.readingForDate(p.id, modalDate);
    var prevRec  = DewateringState.lastActualReading(p.id, modalDate);
    var prevVal  = prevRec ? parseFloat(prevRec.reading) : null;
    var prevDate = prevRec ? prevRec.date : null;
    var isStopped = existing ? !!existing.isStopped : false;
    var st = DEW_PUMP_STATUS[p.status] || DEW_PUMP_STATUS.off;

    // Volume to show if existing reading already saved
    var curReadingVal = existing && !existing.isStopped && existing.reading != null ? parseFloat(existing.reading) : null;
    var initVol = (curReadingVal != null && prevVal != null) ? (curReadingVal - prevVal) : null;
    var initVolHtml = isStopped ? '<span style="color:var(--txt-3)">простой</span>'
                    : initVol != null ? (initVol >= 0 ? '<span style="color:var(--ok)">' + initVol.toFixed(0) + ' м³</span>' : '<span style="color:var(--bad)">⚠ ' + initVol.toFixed(0) + '</span>')
                    : '<span style="color:var(--txt-3)">—</span>';

    // Selected dest
    var existingDists = existing ? DewateringState.getDistributions(existing) : [];

    return '<div style="padding:16px 20px;border-bottom:1px solid var(--line)">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">' +
        '<div style="font-size:12px;font-weight:600;color:var(--txt-1)">' + escHTML(p.name) + '</div>' +
        '<span class="anl-pill anl-pill-' + st.cls + '" style="font-size:9px">' + st.label + '</span>' +
        (p.inventoryNumber ? '<span style="font-size:10px;color:var(--txt-3)">Инв. ' + escHTML(p.inventoryNumber) + '</span>' : '') +
        (p.model ? '<span style="font-size:10px;color:var(--txt-3)">' + escHTML(p.model) + '</span>' : '') +
        '<label style="margin-left:auto;display:flex;align-items:center;gap:5px;font-size:11px;color:var(--txt-3);cursor:pointer">' +
          '<input type="checkbox" id="dew-modal-stopped-' + p.id + '"' + (isStopped ? ' checked' : '') + ' onchange="_dewModalToggleStopped(\'' + p.id + '\')">' +
          ' Насос не работал' +
        '</label>' +
      '</div>' +
      '<div id="dew-modal-fields-' + p.id + '"' + (isStopped ? ' style="display:none"' : '') + '>' +
        '<div style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px">' +
          '<div>' +
            '<div style="font-size:9px;color:var(--txt-3);margin-bottom:3px">Предыдущее показание' + (prevDate ? ' · ' + prevDate : '') + '</div>' +
            '<div style="font-size:18px;font-weight:700;color:var(--txt-2);min-width:80px">' + (prevVal != null ? prevVal.toFixed(0) + ' <span style="font-size:11px;font-weight:400">м³</span>' : '<span style="color:var(--txt-3);font-size:14px">нет данных</span>') + '</div>' +
          '</div>' +
          '<div class="form-group" style="margin:0">' +
            '<label class="form-label" style="font-size:9px">Показание на 06:00</label>' +
            '<input type="number" id="dew-modal-val-' + p.id + '" class="form-control" value="' + (curReadingVal != null ? curReadingVal.toFixed(0) : '') + '" placeholder="м³ накоп." style="width:130px;font-size:15px;font-weight:600" oninput="_dewModalCalcVol(\'' + p.id + '\',' + (prevVal != null ? prevVal : 'null') + ')">' +
          '</div>' +
          '<div>' +
            '<div style="font-size:9px;color:var(--txt-3);margin-bottom:3px">Объём за сутки</div>' +
            '<div id="dew-modal-vol-' + p.id + '" style="font-size:18px;font-weight:700;min-width:80px">' + initVolHtml + '</div>' +
          '</div>' +
          '<div class="form-group" style="margin:0">' +
            '<label class="form-label" style="font-size:9px">Часов работы</label>' +
            '<input type="number" id="dew-modal-hrs-' + p.id + '" class="form-control" value="' + escAttr(String(existing && existing.hoursWorked != null ? existing.hoursWorked : '')) + '" min="0" max="24" placeholder="ч" style="width:72px;font-size:12px">' +
          '</div>' +
          _dewDistBlock(p.id) +
        '</div>' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label" style="font-size:9px">Примечание</label>' +
          '<input type="text" id="dew-modal-notes-' + p.id + '" class="form-control" value="' + escAttr(existing && existing.notes || '') + '" placeholder="необязательно" style="font-size:11px">' +
        '</div>' +
      '</div>' +
      '<div id="dew-modal-stop-reason-' + p.id + '"' + (!isStopped ? ' style="display:none"' : '') + '>' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label" style="font-size:9px">Причина простоя</label>' +
          '<input type="text" id="dew-modal-dreason-' + p.id + '" class="form-control" value="' + escAttr(existing && existing.downtimeReason || '') + '" placeholder="нет воды, авария, ремонт..." style="font-size:11px">' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  var noActivePumpsHtml = !activePumps.length
    ? '<div style="padding:24px 20px;text-align:center;color:var(--txt-3);font-size:12px">Нет активных насосов для этого зумпфа</div>'
    : '';

  var html =
    '<div id="dew-fill-modal" style="position:fixed;inset:0;z-index:2000;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,.7);padding:24px 12px;overflow-y:auto">' +
    '<div style="background:var(--bg-2);border-radius:var(--r);width:min(700px,98vw);box-shadow:0 12px 48px rgba(0,0,0,.6);margin-bottom:24px">' +

      // Header
      '<div style="padding:16px 20px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:12px">' +
        '<div style="flex:1">' +
          '<div style="font-size:14px;font-weight:700;color:var(--txt-1)">' + escHTML(sump.name) + '</div>' +
          '<div style="font-size:11px;color:var(--txt-3)">' + (sump.quarry ? escHTML(sump.quarry) + ' · ' : '') + 'Ежедневное заполнение журнала</div>' +
        '</div>' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label" style="font-size:9px">Дата</label>' +
          '<input type="date" id="dew-modal-date" class="form-control" value="' + escAttr(modalDate) + '" style="width:140px;font-size:12px">' +
        '</div>' +
        '<button class="btn btn-sm btn-outline" onclick="_dewCloseFillModal()" style="font-size:11px;align-self:flex-end">✕ Закрыть</button>' +
      '</div>' +

      // Water level section
      '<div style="padding:14px 20px;border-bottom:1px solid var(--line);background:rgba(34,211,238,.04)">' +
        '<div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--txt-3);margin-bottom:10px">💧 Уровень воды в зумпфе</div>' +
        '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">' +
          '<div class="form-group" style="margin:0">' +
            '<label class="form-label" style="font-size:9px">Отм. зеркала воды, м абс.</label>' +
            '<input type="number" id="dew-modal-wl-elev" class="form-control" value="' + escAttr(String(existingWL ? existingWL.elevation : '')) + '" placeholder="-118.50" style="width:140px;font-size:14px;font-weight:600" oninput="_dewModalWlHint(\'' + sumpId + '\')">' +
          '</div>' +
          '<div class="form-group" style="margin:0">' +
            '<label class="form-label" style="font-size:9px">Время замера</label>' +
            '<input type="time" id="dew-modal-wl-time" class="form-control" value="' + escAttr(existingWL ? existingWL.time : '06:00') + '" style="width:92px;font-size:12px">' +
          '</div>' +
          '<div class="form-group" style="margin:0">' +
            '<label class="form-label" style="font-size:9px">Кто замерил</label>' +
            '<input type="text" id="dew-modal-wl-by" class="form-control" value="' + escAttr(existingWL ? existingWL.measuredBy || '' : '') + '" style="width:130px;font-size:11px">' +
          '</div>' +
          '<div id="dew-modal-wl-hint" style="font-size:11px;color:var(--txt-3);align-self:center;padding-bottom:6px">' +
            (existingWL && bottomElev != null ? '↕ Глубина: <b style="color:' + (existingWL.elevation - bottomElev > 1.5 ? 'var(--warn)' : 'var(--ok)') + '">' + (existingWL.elevation - bottomElev).toFixed(2) + ' м</b>' : (bottomElev == null ? '<span style="color:var(--warn)">Отметка дна не задана</span>' : '')) +
          '</div>' +
        '</div>' +
      '</div>' +

      // Pump sections
      (noActivePumpsHtml || pumpSectionsHtml) +

      // Footer
      '<div style="padding:14px 20px;display:flex;gap:8px;justify-content:flex-end;align-items:center">' +
        '<span style="font-size:11px;color:var(--txt-3);margin-right:auto">' + activePumps.length + ' насос(ов) для заполнения</span>' +
        '<button class="btn btn-sm btn-outline" onclick="_dewCloseFillModal()" style="font-size:11px">Отмена</button>' +
        '<button class="btn btn-sm" style="background:var(--gold);color:#000;font-size:12px;font-weight:600" onclick="_dewSaveFillModal(\'' + sumpId + '\')">💾 Сохранить всё</button>' +
      '</div>' +

    '</div></div>';

  var wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap.firstChild);

  // Init distribution rows for each pump
  activePumps.forEach(function(p) {
    var ex = DewateringState.readingForDate(p.id, modalDate);
    _dewInitDistRows(p.id, ex ? DewateringState.getDistributions(ex) : []);
  });

  // Close on overlay click
  document.getElementById('dew-fill-modal').addEventListener('click', function(e) {
    if (e.target === this) _dewCloseFillModal();
  });
}

function _dewCloseFillModal() {
  var m = document.getElementById('dew-fill-modal');
  if (m) m.remove();
}

function _dewModalCalcVol(pumpId, prevVal) {
  var inp   = document.getElementById('dew-modal-val-' + pumpId);
  var volEl = document.getElementById('dew-modal-vol-' + pumpId);
  if (!inp || !volEl) return;
  var cur = parseFloat(inp.value);
  if (isNaN(cur) || prevVal == null) {
    volEl.innerHTML = '<span style="color:var(--txt-3)">—</span>';
    return;
  }
  var diff = cur - parseFloat(prevVal);
  volEl.innerHTML = diff >= 0
    ? '<span style="color:var(--ok)">' + diff.toFixed(0) + ' м³</span>'
    : '<span style="color:var(--bad)">⚠ ' + diff.toFixed(0) + '</span>';
}

function _dewModalToggleStopped(pumpId) {
  var chk    = document.getElementById('dew-modal-stopped-'     + pumpId);
  var fields = document.getElementById('dew-modal-fields-'      + pumpId);
  var reason = document.getElementById('dew-modal-stop-reason-' + pumpId);
  if (fields) fields.style.display = chk.checked ? 'none' : '';
  if (reason) reason.style.display = chk.checked ? ''     : 'none';
}

function _dewModalWlHint(sumpId) {
  var hint    = document.getElementById('dew-modal-wl-hint');
  var elevInp = document.getElementById('dew-modal-wl-elev');
  if (!hint || !elevInp || elevInp.value === '') { if (hint) hint.innerHTML = ''; return; }
  var bot   = DewateringState.sumpCurrentElevation(sumpId);
  if (bot == null) { hint.innerHTML = '<span style="color:var(--warn)">Отметка дна не задана</span>'; return; }
  var depth = parseFloat(elevInp.value) - bot;
  hint.innerHTML = '↕ Глубина: <b style="color:' + (depth > 1.5 ? 'var(--warn)' : 'var(--ok)') + '">' + depth.toFixed(2) + ' м</b> (дно ' + bot.toFixed(1) + ' м абс.)';
}

function _dewSaveFillModal(sumpId) {
  var dateEl = document.getElementById('dew-modal-date');
  var date   = dateEl ? dateEl.value : null;
  if (!date) { Toast.show('Укажите дату', 'warning'); return; }

  // Save water level if entered
  var elevEl = document.getElementById('dew-modal-wl-elev');
  var elev   = elevEl ? parseFloat(elevEl.value) : NaN;
  if (!isNaN(elev)) {
    var timeEl = document.getElementById('dew-modal-wl-time');
    var byEl   = document.getElementById('dew-modal-wl-by');
    var wlData = {
      sumpId:     sumpId,
      date:       date,
      time:       timeEl ? timeEl.value : '06:00',
      elevation:  elev,
      measuredBy: byEl ? byEl.value.trim() : '',
      notes:      '',
    };
    var existingWL = DewateringState.waterLevels.find(function(w) { return w.sumpId === sumpId && w.date === date; });
    if (existingWL) DewateringState.updateWaterLevel(existingWL.id, wlData);
    else            DewateringState.addWaterLevel(wlData);
  }

  // Save pump readings
  var pumps = DewateringState.pumpsOfSump(sumpId).filter(function(p) {
    return p.status === 'working' || p.status === 'standby';
  });
  var saved = 0;

  pumps.forEach(function(p) {
    var stoppedEl = document.getElementById('dew-modal-stopped-' + p.id);
    if (!stoppedEl) return;
    var isStopped = stoppedEl.checked;
    var existing  = DewateringState.readingForDate(p.id, date);

    var data = {
      pumpId:         p.id,
      date:           date,
      isStopped:      isStopped,
      isReset:        false,
      isManualVolume: false,
      downtimeReason: isStopped ? (((document.getElementById('dew-modal-dreason-' + p.id) || {}).value) || '').trim() : '',
    };

    if (!isStopped) {
      var valEl = document.getElementById('dew-modal-val-' + p.id);
      if (!valEl || valEl.value.trim() === '') return;
      data.reading       = parseFloat(valEl.value);
      data.hoursWorked    = parseFloat((document.getElementById('dew-modal-hrs-'   + p.id) || {}).value) || null;
      data.distributions  = _dewGetDistributions(p.id);
      data.notes          = (((document.getElementById('dew-modal-notes-' + p.id) || {}).value) || '').trim();
    }

    if (existing) DewateringState.updateReading(existing.id, data);
    else          DewateringState.addReading(data);
    saved++;
  });

  _dewCloseFillModal();
  _dewRenderOverview();
  Toast.show('Сохранено: ' + saved + (saved === 1 ? ' насос' : ' насосов') + (isNaN(elev) ? '' : ' + уровень воды'), 'success');
}

// ── Зумпфы ───────────────────────────────────────────────────

function _dewRenderSumps() {
  var el = document.getElementById('dew-panel-sumps');
  if (!el) return;

  var toggleLabel = _dewShowPumpRegistry ? '← К зумпфам' : '📋 Реестр насосов';
  var topBar = '<div style="display:flex;justify-content:flex-end;margin-bottom:12px">' +
    '<button class="btn btn-sm btn-outline" onclick="_dewTogglePumpRegistry()" style="font-size:11px">' + toggleLabel + '</button>' +
    '</div>';

  if (_dewShowPumpRegistry) {
    el.innerHTML = topBar +
      '<div id="dew-pump-form"></div>' +
      '<div id="dew-pump-events-panel"></div>' +
      '<div id="dew-registry-content"></div>';
    _dewRenderPumpRegistry();
    return;
  }

  var pumpsToggleIcon = _dewPumpsCollapsed ? '▶' : '▼';
  var destsToggleIcon = _dewDestsCollapsed ? '▶' : '▼';

  el.innerHTML = topBar +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">' +
      '<div>' +
        _dewSectionHeader('Зумпфы', 'dew-btn-add-sump', '+ Зумпф', true) +
        '<div id="dew-sumps-list"></div><div id="dew-sump-form"></div>' +
      '</div>' +
      '<div>' +
        // Collapsible pumps section
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:' + (_dewPumpsCollapsed ? '4' : '10') + 'px">' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<button class="btn btn-sm btn-outline" style="font-size:9px;padding:1px 5px;min-width:22px" onclick="_dewTogglePumpsSection()">' + pumpsToggleIcon + '</button>' +
            '<span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3)">Насосы</span>' +
          '</div>' +
          '<button class="btn btn-sm btn-outline" id="dew-btn-add-pump" style="font-size:11px">+ Насос</button>' +
        '</div>' +
        '<div id="dew-pumps-section"' + (_dewPumpsCollapsed ? ' style="display:none"' : '') + '>' +
          '<div id="dew-pumps-list"></div><div id="dew-pump-form"></div>' +
          '<div id="dew-pump-events-panel"></div>' +
        '</div>' +
        // Collapsible destinations section
        '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:' + (_dewDestsCollapsed ? '4' : '10') + 'px">' +
            '<div style="display:flex;align-items:center;gap:6px">' +
              '<button class="btn btn-sm btn-outline" style="font-size:9px;padding:1px 5px;min-width:22px" onclick="_dewToggleDestsSection()">' + destsToggleIcon + '</button>' +
              '<span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3)">Направления перекачки</span>' +
            '</div>' +
            '<button class="btn btn-sm btn-outline" id="dew-btn-add-dest" style="font-size:11px">+ Добавить</button>' +
          '</div>' +
          '<div id="dew-dests-section"' + (_dewDestsCollapsed ? ' style="display:none"' : '') + '>' +
            '<div id="dew-dest-list"></div><div id="dew-dest-form"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  _dewRenderSumpsList();
  if (!_dewPumpsCollapsed) _dewRenderPumpsList();
  if (!_dewDestsCollapsed) _dewRenderDestList();

  document.getElementById('dew-btn-add-sump').addEventListener('click', function() { _dewOpenSumpForm(null); });
  document.getElementById('dew-btn-add-pump').addEventListener('click', function() {
    if (!DewateringState.sumps.length) { Toast.show('Сначала добавьте зумпф', 'warning'); return; }
    if (_dewPumpsCollapsed) { _dewPumpsCollapsed = false; _dewRenderSumps(); return; }
    _dewOpenPumpForm(null);
  });
  document.getElementById('dew-btn-add-dest').addEventListener('click', function() {
    if (_dewDestsCollapsed) { _dewDestsCollapsed = false; _dewRenderSumps(); return; }
    _dewOpenDestForm();
  });
}

function _dewTogglePumpsSection() {
  _dewPumpsCollapsed = !_dewPumpsCollapsed;
  _dewRenderSumps();
}

function _dewToggleDestsSection() {
  _dewDestsCollapsed = !_dewDestsCollapsed;
  _dewRenderSumps();
}

function _dewTogglePumpRegistry() {
  _dewShowPumpRegistry = !_dewShowPumpRegistry;
  _dewRenderSumps();
}

function _dewRenderPumpRegistry() {
  var el = document.getElementById('dew-registry-content');
  if (!el) return;

  var pumps   = DewateringState.pumps;
  var working = pumps.filter(function(p) { return p.status === 'working'; }).length;
  var repair  = pumps.filter(function(p) { return p.status === 'repair';  }).length;

  var header =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
      '<div>' +
        '<div style="font-size:13px;font-weight:600;color:var(--txt-1)">Все насосы</div>' +
        '<div style="font-size:11px;color:var(--txt-3);margin-top:2px">' +
          'Всего: <b style="color:var(--txt-2)">' + pumps.length + '</b> · ' +
          'Работают: <b style="color:var(--ok)">' + working + '</b>' +
          (repair ? ' · Ремонт: <b style="color:var(--warn)">' + repair + '</b>' : '') +
        '</div>' +
      '</div>' +
      '<button class="btn btn-sm" style="background:var(--gold);color:#000;font-size:11px" id="dew-btn-add-pump-reg">+ Насос</button>' +
    '</div>';

  if (!pumps.length) {
    el.innerHTML = header + '<div class="card" style="padding:24px;text-align:center;color:var(--txt-3);font-size:12px">Насосы не добавлены</div>';
    document.getElementById('dew-btn-add-pump-reg').addEventListener('click', function() {
      if (!DewateringState.sumps.length) { Toast.show('Сначала добавьте зумпф', 'warning'); return; }
      _dewOpenPumpForm(null);
    });
    return;
  }

  var sorted = pumps.slice().sort(function(a, b) {
    var qa = a.quarry || '', qb = b.quarry || '';
    if (qa !== qb) return qa.localeCompare(qb);
    var sa = DewateringState.sumpById(a.sumpId), sb = DewateringState.sumpById(b.sumpId);
    var sna = sa ? sa.name : '', snb = sb ? sb.name : '';
    if (sna !== snb) return sna.localeCompare(snb);
    return (a.name || '').localeCompare(b.name || '');
  });

  el.innerHTML = header +
    '<div style="overflow-x:auto">' +
    '<table style="width:100%;border-collapse:collapse;font-size:11px;min-width:700px">' +
    '<thead><tr style="color:var(--txt-3);font-size:10px;text-transform:uppercase;border-bottom:1px solid var(--line)">' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Насос</th>' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Инв. №</th>' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Марка / Модель</th>' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Зумпф</th>' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Карьер</th>' +
      '<th style="padding:6px 8px;text-align:center;font-weight:500">Статус</th>' +
      '<th style="padding:6px 8px;text-align:right;font-weight:500">Q, м³/ч</th>' +
      '<th style="padding:6px 8px;text-align:right;font-weight:500">Напор, м</th>' +
      '<th style="padding:6px 8px;text-align:right;font-weight:500">∑ м³</th>' +
      '<th style="padding:6px 8px"></th>' +
    '</tr></thead><tbody>' +
    sorted.map(function(p) {
      var sump = DewateringState.sumpById(p.sumpId);
      var st   = DEW_PUMP_STATUS[p.status] || DEW_PUMP_STATUS.off;
      var vol  = DewateringState.totalVolumePump(p.id);
      var evts = DewateringState.pumpEvents.filter(function(e) { return e.installedPumpId === p.id || e.removedPumpId === p.id; }).length;
      return '<tr style="border-bottom:1px solid var(--line-2)">' +
        '<td style="padding:6px 8px">' +
          '<div style="color:var(--txt-1);font-weight:500">' + escHTML(p.name) + '</div>' +
          (p.type ? '<div style="font-size:9px;color:var(--txt-3)">' + (DEW_PUMP_TYPE[p.type] || '') + '</div>' : '') +
        '</td>' +
        '<td style="padding:6px 8px;color:var(--txt-3)">' + escHTML(p.inventoryNumber || '—') + '</td>' +
        '<td style="padding:6px 8px;color:var(--txt-2)">' +
          escHTML(p.model || '—') +
          (p.serialNumber ? '<div style="font-size:9px;color:var(--txt-3)">с/н ' + escHTML(p.serialNumber) + '</div>' : '') +
        '</td>' +
        '<td style="padding:6px 8px;color:var(--txt-2)">' + (sump ? escHTML(sump.name) : '<span style="color:var(--txt-3)">—</span>') + '</td>' +
        '<td style="padding:6px 8px;color:var(--txt-3)">' + escHTML(p.quarry || '—') + '</td>' +
        '<td style="padding:6px 8px;text-align:center">' +
          '<span class="anl-pill anl-pill-' + st.cls + '" style="font-size:9px">' + st.label + '</span>' +
        '</td>' +
        '<td style="padding:6px 8px;text-align:right;color:var(--txt-1)">' + (p.capacity != null ? p.capacity : '—') + '</td>' +
        '<td style="padding:6px 8px;text-align:right;color:var(--txt-2)">' + (p.head != null ? p.head : '—') + '</td>' +
        '<td style="padding:6px 8px;text-align:right;color:var(--ok);font-weight:500">' + vol.toFixed(0) + '</td>' +
        '<td style="padding:6px 8px;text-align:right;white-space:nowrap">' +
          '<button class="btn btn-sm btn-outline" title="Событие" style="font-size:10px;padding:2px 6px;margin-right:2px" onclick="_dewOpenPumpEvents(\'' + p.id + '\')">🔧' + (evts ? '<sup>' + evts + '</sup>' : '') + '</button>' +
          '<button class="btn btn-sm btn-outline" title="Редактировать" style="font-size:10px;padding:2px 7px;margin-right:2px" onclick="_dewOpenPumpForm(\'' + p.id + '\')">✎</button>' +
          '<button class="btn btn-sm" title="Удалить" style="font-size:10px;padding:2px 7px;background:rgba(248,113,113,.12);color:var(--bad);border:1px solid rgba(248,113,113,.25)" onclick="_dewDeletePump(\'' + p.id + '\')">✕</button>' +
        '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table></div>';

  document.getElementById('dew-btn-add-pump-reg').addEventListener('click', function() {
    if (!DewateringState.sumps.length) { Toast.show('Сначала добавьте зумпф', 'warning'); return; }
    _dewOpenPumpForm(null);
  });
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
    '<label style="display:flex;align-items:center;gap:7px;font-size:12px;color:var(--txt-2);margin-top:10px;cursor:pointer">' +
      '<input type="checkbox" id="dew-pf-countInVolume"' + ((!p || p.countInVolume !== false) ? ' checked' : '') + '>' +
      ' Учитывать показания насоса в суммарном объёме' +
    '</label>' +
    '<p style="font-size:10px;color:var(--txt-3);margin:3px 0 8px 19px">Снимите галочку, если насос перекачивает в промежуточный зумпф — чтобы избежать двойного счёта</p>' +
    '<div style="display:flex;gap:8px;margin-top:6px">' +
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
      countInVolume: document.getElementById('dew-pf-countInVolume').checked,
    };
    if (id) DewateringState.updatePump(id, data);
    else    DewateringState.addPump(data);
    formEl.innerHTML = '';
    if (_dewShowPumpRegistry) _dewRenderPumpRegistry();
    else                      _dewRenderPumpsList();
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
  if (_dewShowPumpRegistry) _dewRenderPumpRegistry();
  else                      _dewRenderPumpsList();
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

  function jSumpOpts(quarry) {
    var filtered = quarry
      ? DewateringState.sumps.filter(function(s) { return (s.quarry || '') === quarry; })
      : DewateringState.sumps;
    return '<option value="">Все зумпфы</option>' + filtered.map(function(s) {
      return '<option value="' + s.id + '"' + (_dewJFilter.sumpId === s.id ? ' selected' : '') + '>' + escHTML(s.name) + '</option>';
    }).join('');
  }

  el.innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start">' +
      // LEFT: quick daily entry
      '<div>' +
        '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3);margin-bottom:8px">Ввод показаний (6:00)</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
          '<select id="dew-jf-l-quarry" class="form-control" style="width:130px;font-size:12px">' + _dewQuarryOpts(_dewJFilter.quarry) + '</select>' +
          '<select id="dew-jf-l-sump" class="form-control" style="width:150px;font-size:12px">' + jSumpOpts(_dewJFilter.quarry) + '</select>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
          '<input type="date" id="dew-jr-date" class="form-control" value="' + _dewJFilter.date + '" style="width:150px;font-size:12px">' +
          '<button class="btn btn-sm" style="background:var(--gold);color:#000;font-size:11px" id="dew-jr-save-all">💾 Сохранить всё</button>' +
        '</div>' +
        '<div id="dew-jr-quick"></div>' +
      '</div>' +
      // RIGHT: history table
      '<div>' +
        '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3);margin-bottom:8px">История показаний</div>' +
        '<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;align-items:center">' +
          '<select id="dew-jf-quarry" class="form-control" style="width:130px;font-size:12px">' + _dewQuarryOpts(_dewJFilter.quarry) + '</select>' +
          '<select id="dew-jf-sump" class="form-control" style="width:150px;font-size:12px">' + jSumpOpts(_dewJFilter.quarry) + '</select>' +
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
  document.getElementById('dew-jf-l-quarry').addEventListener('change', function() {
    _dewJFilter.quarry = this.value;
    _dewJFilter.sumpId = '';
    var lSump = document.getElementById('dew-jf-l-sump');
    if (lSump) lSump.innerHTML = jSumpOpts(this.value);
    _dewRenderQuickEntry(_dewJFilter.date);
  });
  document.getElementById('dew-jf-l-sump').addEventListener('change', function() {
    _dewJFilter.sumpId = this.value;
    _dewRenderQuickEntry(_dewJFilter.date);
  });
  document.getElementById('dew-jf-quarry').addEventListener('change', function() {
    _dewJFilter.quarry = this.value;
    _dewJFilter.sumpId = '';
    var rSump = document.getElementById('dew-jf-sump');
    if (rSump) rSump.innerHTML = jSumpOpts(this.value);
    _dewRenderReadingsTable();
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
  var qFilter = _dewJFilter.quarry, sFilter = _dewJFilter.sumpId;
  DewateringState.sumps.forEach(function(sump) {
    if (qFilter && (sump.quarry || '') !== qFilter) return;
    if (sFilter && sump.id !== sFilter) return;
    var pumps = DewateringState.pumpsOfSump(sump.id).filter(function(p) { return p.status === 'working' || p.status === 'standby'; });
    if (!pumps.length) return;
    html += '<div class="card" style="padding:12px 14px;margin-bottom:8px">' +
      '<div style="font-size:11px;font-weight:600;color:var(--txt-1);margin-bottom:10px">' + escHTML(sump.name) + '</div>';

    pumps.forEach(function(p) {
      var existing = DewateringState.readingForDate(p.id, date);
      var prevRec  = DewateringState.lastActualReading(p.id, date);
      var prevVal  = prevRec ? prevRec.reading : null;
      var prevDate = prevRec ? prevRec.date : null;
      var isStopped = existing ? existing.isStopped : false;

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
            _dewDistBlock(p.id) +
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

  // Init distribution rows for each pump after DOM is ready
  DewateringState.sumps.forEach(function(sump) {
    DewateringState.pumpsOfSump(sump.id)
      .filter(function(p) { return p.status === 'working' || p.status === 'standby'; })
      .forEach(function(p) {
        var ex = DewateringState.readingForDate(p.id, date);
        _dewInitDistRows(p.id, ex ? DewateringState.getDistributions(ex) : []);
      });
  });
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
      data.hoursWorked   = parseFloat((document.getElementById('dew-qe-hrs-'   + p.id) || {}).value) || null;
      data.distributions = _dewGetDistributions(p.id);
      data.notes         = ((document.getElementById('dew-qe-notes-' + p.id) || {}).value || '').trim();
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

function _dewReadingDestOpts(selectedId) {
  return '<option value="">— не указано —</option>' +
    DewateringState.destinations.map(function(d) {
      return '<option value="' + d.id + '"' + (d.id === selectedId ? ' selected' : '') + '>' + escHTML(d.name) + '</option>';
    }).join('');
}

function _dewRenderReadingsTable() {
  var el    = document.getElementById('dew-jr-table');
  var sumEl = document.getElementById('dew-jr-summary');
  if (!el) return;

  var sumpId = _dewJFilter.sumpId;
  var quarry = _dewJFilter.quarry;
  var pumpsFilter;
  if (sumpId) {
    pumpsFilter = DewateringState.pumpsOfSump(sumpId).map(function(p) { return p.id; });
  } else if (quarry) {
    var qSumps = DewateringState.sumps.filter(function(s) { return (s.quarry || '') === quarry; });
    pumpsFilter = qSumps.reduce(function(acc, s) {
      return acc.concat(DewateringState.pumpsOfSump(s.id).map(function(p) { return p.id; }));
    }, []);
  } else {
    pumpsFilter = DewateringState.pumps.map(function(p) { return p.id; });
  }

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
      '<th style="padding:6px 8px"></th>' +
    '</tr></thead><tbody>' +
    records.map(function(r) {
      var pump      = DewateringState.pumpById(r.pumpId);
      var sump      = pump ? DewateringState.sumpById(pump.sumpId) : null;
      var vol       = DewateringState.computedVolume(r);
      var isEditing = r.id === _dewEditReadingId;
      var rDists    = DewateringState.getDistributions(r);
      var distDisp  = rDists.length
        ? rDists.map(function(d) {
            var dst = DewateringState.destById(d.destinationId);
            return (dst ? escHTML(dst.name) : '?') + (rDists.length > 1 ? ' ' + d.pct + '%' : '');
          }).join(', ')
        : '—';
      var volStr    = r.isStopped ? '<span style="color:var(--txt-3)">простой</span>'
                   : vol == null  ? '<span style="color:var(--txt-3)">нет пред.</span>'
                   : '<span style="color:var(--ok);font-weight:600">' + vol.toFixed(0) + '</span>';

      var dataRow =
        '<tr style="border-bottom:' + (isEditing ? 'none' : '1px solid var(--line-2)') + (isEditing ? ';background:rgba(255,255,255,.03)' : '') + '">' +
        '<td style="padding:5px 8px;color:var(--txt-1);white-space:nowrap">' + r.date + '</td>' +
        '<td style="padding:5px 8px">' +
          '<div style="color:var(--txt-1)">' + (pump ? escHTML(pump.name) : '—') + '</div>' +
          (sump ? '<div style="color:var(--txt-3);font-size:9px">' + escHTML(sump.name) + '</div>' : '') +
        '</td>' +
        '<td style="padding:5px 8px;text-align:right;color:var(--txt-2)">' + (r.isStopped ? '—' : (r.reading != null ? parseFloat(r.reading).toFixed(0) : '—')) + '</td>' +
        '<td style="padding:5px 8px;text-align:right">' + volStr + '</td>' +
        '<td style="padding:5px 8px;text-align:right;color:var(--txt-3)">' + (r.hoursWorked != null ? parseFloat(r.hoursWorked).toFixed(1) : '—') + '</td>' +
        '<td style="padding:5px 8px;color:var(--txt-3);font-size:10px">' + distDisp + '</td>' +
        '<td style="padding:5px 8px;text-align:right;white-space:nowrap">' +
          '<button class="btn btn-sm btn-outline" title="Редактировать" style="font-size:10px;padding:2px 5px;margin-right:3px" onclick="_dewEditReading(\'' + r.id + '\')">' + (isEditing ? '✕' : '✎') + '</button>' +
          (!isEditing ? '<button class="btn btn-sm" style="font-size:10px;padding:2px 5px;background:rgba(248,113,113,.1);color:var(--bad);border:1px solid rgba(248,113,113,.2)" onclick="_dewDeleteReading(\'' + r.id + '\')">✕</button>' : '') +
        '</td>' +
        '</tr>';

      if (!isEditing) return dataRow;

      var stopped = !!r.isStopped;
      var editRow =
        '<tr style="background:var(--bg-3);border-bottom:1px solid var(--line)">' +
        '<td colspan="7" style="padding:10px 12px">' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px">' +
            '<div class="form-group" style="margin:0">' +
              '<label class="form-label" style="font-size:9px">Дата</label>' +
              '<input type="date" id="dew-er-date-' + r.id + '" class="form-control" value="' + escAttr(r.date) + '" style="width:132px;font-size:11px">' +
            '</div>' +
            '<label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--txt-3);cursor:pointer;padding-bottom:6px">' +
              '<input type="checkbox" id="dew-er-stopped-' + r.id + '"' + (stopped ? ' checked' : '') + ' onchange="_dewToggleEditReadingStopped(\'' + r.id + '\')">' +
              ' Простой' +
            '</label>' +
          '</div>' +
          '<div id="dew-er-fields-' + r.id + '"' + (stopped ? ' style="display:none"' : '') + '>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">' +
              '<div class="form-group" style="margin:0">' +
                '<label class="form-label" style="font-size:9px">Показание, м³</label>' +
                '<input type="number" id="dew-er-val-' + r.id + '" class="form-control" value="' + escAttr(String(r.reading != null ? r.reading : '')) + '" style="width:110px;font-size:12px">' +
              '</div>' +
              '<div class="form-group" style="margin:0">' +
                '<label class="form-label" style="font-size:9px">Часов</label>' +
                '<input type="number" id="dew-er-hrs-' + r.id + '" class="form-control" value="' + escAttr(String(r.hoursWorked != null ? r.hoursWorked : '')) + '" min="0" max="24" style="width:70px;font-size:12px">' +
              '</div>' +
              _dewDistBlock('er-' + r.id) +
              '<div class="form-group" style="margin:0;flex:1;min-width:100px">' +
                '<label class="form-label" style="font-size:9px">Примечание</label>' +
                '<input type="text" id="dew-er-notes-' + r.id + '" class="form-control" value="' + escAttr(r.notes || '') + '" style="font-size:11px">' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div id="dew-er-stop-reason-' + r.id + '"' + (!stopped ? ' style="display:none"' : '') + '>' +
            '<div class="form-group" style="margin:6px 0 0">' +
              '<label class="form-label" style="font-size:9px">Причина простоя</label>' +
              '<input type="text" id="dew-er-dreason-' + r.id + '" class="form-control" value="' + escAttr(r.downtimeReason || '') + '" placeholder="нет воды, авария..." style="font-size:11px">' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:6px;margin-top:10px">' +
            '<button class="btn btn-sm" style="background:var(--gold);color:#000;font-size:11px" onclick="_dewSaveEditReading(\'' + r.id + '\')">Сохранить</button>' +
            '<button class="btn btn-sm btn-outline" style="font-size:11px" onclick="_dewCancelEditReading()">Отмена</button>' +
          '</div>' +
        '</td>' +
        '</tr>';

      return dataRow + editRow;
    }).join('') +
    '</tbody></table></div>';

  // Init dist rows for currently open edit row
  if (_dewEditReadingId) {
    var editRec = DewateringState.meterReadings.find(function(r) { return r.id === _dewEditReadingId; });
    if (editRec && !editRec.isStopped) {
      _dewInitDistRows('er-' + _dewEditReadingId, DewateringState.getDistributions(editRec));
    }
  }
}

function _dewEditReading(id) {
  _dewEditReadingId = (_dewEditReadingId === id) ? null : id;
  _dewRenderReadingsTable();
}

function _dewCancelEditReading() {
  _dewEditReadingId = null;
  _dewRenderReadingsTable();
}

function _dewToggleEditReadingStopped(id) {
  var chk     = document.getElementById('dew-er-stopped-' + id);
  var fields  = document.getElementById('dew-er-fields-' + id);
  var reason  = document.getElementById('dew-er-stop-reason-' + id);
  if (fields) fields.style.display = chk.checked ? 'none' : '';
  if (reason) reason.style.display = chk.checked ? ''     : 'none';
}

function _dewSaveEditReading(id) {
  var r = DewateringState.meterReadings.find(function(x) { return x.id === id; });
  if (!r) return;
  var stopped = !!(document.getElementById('dew-er-stopped-' + id) || {}).checked;
  var data = {
    date:           (document.getElementById('dew-er-date-' + id) || {}).value || r.date,
    isStopped:      stopped,
    isReset:        r.isReset || false,
    isManualVolume: r.isManualVolume || false,
    downtimeReason: stopped ? (((document.getElementById('dew-er-dreason-' + id) || {}).value) || '').trim() : '',
  };
  if (!stopped) {
    var valEl   = document.getElementById('dew-er-val-'   + id);
    var hrsEl   = document.getElementById('dew-er-hrs-'   + id);
    var notesEl = document.getElementById('dew-er-notes-' + id);
    if (valEl)   data.reading      = parseFloat(valEl.value);
    if (hrsEl)   data.hoursWorked  = parseFloat(hrsEl.value) || null;
    data.distributions = _dewGetDistributions('er-' + id);
    if (notesEl) data.notes        = notesEl.value.trim();
  }
  DewateringState.updateReading(id, data);
  _dewEditReadingId = null;
  _dewRenderReadingsTable();
  _dewRenderQuickEntry(_dewJFilter.date);
  Toast.show('Запись обновлена', 'success');
}

function _dewDeleteReading(id) {
  if (!confirm('Удалить запись показания?')) return;
  DewateringState.deleteReading(id);
  _dewEditReadingId = null;
  _dewRenderReadingsTable();
  _dewRenderQuickEntry(_dewJFilter.date);
}

// ── Уровни воды ──────────────────────────────────────────────

function _dewRenderLevels() {
  var el = document.getElementById('dew-panel-levels');
  if (!el) return;

  var today = new Date().toISOString().slice(0, 10);

  function lvSumpOpts(quarry, forForm) {
    var filtered = quarry
      ? DewateringState.sumps.filter(function(s) { return (s.quarry || '') === quarry; })
      : DewateringState.sumps;
    var emptyLabel = forForm ? '— выберите зумпф —' : 'Все зумпфы';
    return '<option value="">' + emptyLabel + '</option>' + filtered.map(function(s) {
      return '<option value="' + s.id + '"' + (_dewLFilter.sumpId === s.id ? ' selected' : '') + '>' + escHTML(s.name) + '</option>';
    }).join('');
  }

  el.innerHTML =
    '<div style="display:grid;grid-template-columns:300px 1fr;gap:14px;align-items:start">' +
      // LEFT: add form
      '<div>' +
        '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3);margin-bottom:8px">Новый замер уровня</div>' +
        '<div class="card" style="padding:14px">' +
        '<div class="form-group"><label class="form-label">Зумпф</label>' +
        '<select id="dew-lv-sump" class="form-control">' + lvSumpOpts('', true) + '</select></div>' +
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
        '<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">' +
          '<select id="dew-lv-filter-quarry" class="form-control" style="font-size:12px;width:130px">' + _dewQuarryOpts(_dewLFilter.quarry) + '</select>' +
          '<select id="dew-lv-filter-sump" class="form-control" style="font-size:12px;width:160px">' + lvSumpOpts(_dewLFilter.quarry, false) + '</select>' +
        '</div>' +
        '<div id="dew-lv-table"></div>' +
        '<div id="dew-lv-chart" style="margin-top:12px"></div>' +
      '</div>' +
    '</div>';

  _dewRenderLevelsTable(_dewLFilter.sumpId);

  document.getElementById('dew-lv-sump').addEventListener('change', function() { _dewLvUpdateDepthHint(); });
  document.getElementById('dew-lv-elev').addEventListener('input', function() { _dewLvUpdateDepthHint(); });
  document.getElementById('dew-lv-filter-quarry').addEventListener('change', function() {
    _dewLFilter.quarry = this.value;
    _dewLFilter.sumpId = '';
    var sf = document.getElementById('dew-lv-filter-sump');
    if (sf) sf.innerHTML = lvSumpOpts(this.value, false);
    _dewRenderLevelsTable('');
  });
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

  var sumpOpts = DewateringState.sumps.map(function(s) {
    return '<option value="' + s.id + '">' + escHTML(s.name) + '</option>';
  }).join('');

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
      var isEditing = w.id === _dewEditLevelId;

      var dataRow =
        '<tr style="border-bottom:' + (isEditing ? 'none' : '1px solid var(--line-2)') + (isEditing ? ';background:rgba(255,255,255,.03)' : '') + '">' +
        '<td style="padding:5px 8px;color:var(--txt-1)">' + w.date + '</td>' +
        '<td style="padding:5px 8px;color:var(--txt-3)">' + (w.time || '—') + '</td>' +
        '<td style="padding:5px 8px;color:var(--txt-2)">' + (sump ? escHTML(sump.name) : '—') + '</td>' +
        '<td style="padding:5px 8px;text-align:right;font-weight:600;color:var(--txt-1)">' + parseFloat(w.elevation).toFixed(2) + '</td>' +
        '<td style="padding:5px 8px;text-align:right">' + depthStr + '</td>' +
        '<td style="padding:5px 8px;color:var(--txt-3)">' + escHTML(w.measuredBy || '') + '</td>' +
        '<td style="padding:5px 8px;text-align:right;white-space:nowrap">' +
          '<button class="btn btn-sm btn-outline" title="Редактировать" style="font-size:10px;padding:2px 5px;margin-right:3px" onclick="_dewEditLevel(\'' + w.id + '\')">' + (isEditing ? '✕' : '✎') + '</button>' +
          (!isEditing ? '<button class="btn btn-sm" style="font-size:10px;padding:2px 5px;background:rgba(248,113,113,.1);color:var(--bad);border:1px solid rgba(248,113,113,.2)" onclick="_dewDeleteWaterLevel(\'' + w.id + '\')">✕</button>' : '') +
        '</td>' +
        '</tr>';

      if (!isEditing) return dataRow;

      var editRow =
        '<tr style="background:var(--bg-3);border-bottom:1px solid var(--line)">' +
        '<td colspan="7" style="padding:10px 12px">' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">' +
            '<div class="form-group" style="margin:0">' +
              '<label class="form-label" style="font-size:9px">Дата</label>' +
              '<input type="date" id="dew-el-date-' + w.id + '" class="form-control" value="' + escAttr(w.date) + '" style="width:132px;font-size:11px">' +
            '</div>' +
            '<div class="form-group" style="margin:0">' +
              '<label class="form-label" style="font-size:9px">Время</label>' +
              '<input type="time" id="dew-el-time-' + w.id + '" class="form-control" value="' + escAttr(w.time || '06:00') + '" style="width:90px;font-size:11px">' +
            '</div>' +
            '<div class="form-group" style="margin:0">' +
              '<label class="form-label" style="font-size:9px">Зумпф</label>' +
              '<select id="dew-el-sump-' + w.id + '" class="form-control" style="font-size:11px">' +
                DewateringState.sumps.map(function(s) {
                  return '<option value="' + s.id + '"' + (s.id === w.sumpId ? ' selected' : '') + '>' + escHTML(s.name) + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            '<div class="form-group" style="margin:0">' +
              '<label class="form-label" style="font-size:9px">Отм. зеркала, м абс.</label>' +
              '<input type="number" id="dew-el-elev-' + w.id + '" class="form-control" value="' + escAttr(String(w.elevation)) + '" style="width:110px;font-size:12px">' +
            '</div>' +
            '<div class="form-group" style="margin:0">' +
              '<label class="form-label" style="font-size:9px">Кто замерил</label>' +
              '<input type="text" id="dew-el-by-' + w.id + '" class="form-control" value="' + escAttr(w.measuredBy || '') + '" style="font-size:11px;width:120px">' +
            '</div>' +
            '<div class="form-group" style="margin:0;flex:1;min-width:100px">' +
              '<label class="form-label" style="font-size:9px">Примечание</label>' +
              '<input type="text" id="dew-el-notes-' + w.id + '" class="form-control" value="' + escAttr(w.notes || '') + '" style="font-size:11px">' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:6px;margin-top:10px">' +
            '<button class="btn btn-sm" style="background:var(--gold);color:#000;font-size:11px" onclick="_dewSaveEditLevel(\'' + w.id + '\')">Сохранить</button>' +
            '<button class="btn btn-sm btn-outline" style="font-size:11px" onclick="_dewCancelEditLevel()">Отмена</button>' +
          '</div>' +
        '</td>' +
        '</tr>';

      return dataRow + editRow;
    }).join('') +
    '</tbody></table></div>';

  _dewRenderLevelsChart(records, sumpId);
}

function _dewEditLevel(id) {
  _dewEditLevelId = (_dewEditLevelId === id) ? null : id;
  _dewRenderLevelsTable(_dewLFilter.sumpId);
}

function _dewCancelEditLevel() {
  _dewEditLevelId = null;
  _dewRenderLevelsTable(_dewLFilter.sumpId);
}

function _dewSaveEditLevel(id) {
  var w = DewateringState.waterLevels.find(function(x) { return x.id === id; });
  if (!w) return;
  var elevVal = parseFloat((document.getElementById('dew-el-elev-' + id) || {}).value);
  if (isNaN(elevVal)) { Toast.show('Введите отметку зеркала', 'warning'); return; }
  var data = {
    date:       (document.getElementById('dew-el-date-'  + id) || {}).value || w.date,
    time:       (document.getElementById('dew-el-time-'  + id) || {}).value || w.time,
    sumpId:     (document.getElementById('dew-el-sump-'  + id) || {}).value || w.sumpId,
    elevation:  elevVal,
    measuredBy: (((document.getElementById('dew-el-by-'    + id) || {}).value) || '').trim(),
    notes:      (((document.getElementById('dew-el-notes-' + id) || {}).value) || '').trim(),
  };
  DewateringState.updateWaterLevel(id, data);
  _dewEditLevelId = null;
  _dewRenderLevelsTable(_dewLFilter.sumpId);
  Toast.show('Замер обновлён', 'success');
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
  _dewEditLevelId = null;
  _dewRenderLevelsTable(_dewLFilter.sumpId);
}

// ── Аналитика ────────────────────────────────────────────────

function _dewRenderAnalytics() {
  var el = document.getElementById('dew-panel-analytics');
  if (!el) return;

  function anlSumpOpts(quarry) {
    var filtered = quarry
      ? DewateringState.sumps.filter(function(s) { return (s.quarry || '') === quarry; })
      : DewateringState.sumps;
    return '<option value="">Все зумпфы</option>' + filtered.map(function(s) {
      return '<option value="' + s.id + '"' + (_dewAFilter.sumpId === s.id ? ' selected' : '') + '>' + escHTML(s.name) + '</option>';
    }).join('');
  }

  el.innerHTML =
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;padding:10px 12px;background:var(--bg-2);border-radius:var(--r);border:1px solid var(--line)">' +
      '<span style="font-size:11px;color:var(--txt-3);white-space:nowrap">Фильтр:</span>' +
      '<select id="dew-af-quarry" class="form-control" style="width:130px;font-size:12px">' + _dewQuarryOpts(_dewAFilter.quarry) + '</select>' +
      '<select id="dew-af-sump" class="form-control" style="width:160px;font-size:12px">' + anlSumpOpts(_dewAFilter.quarry) + '</select>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
      '<div class="card" style="padding:14px"><div class="card-title">Объём откачки (м³/сутки) · 30 дней</div><div id="dew-ch-trend"></div></div>' +
      '<div class="card" style="padding:14px"><div class="card-title">Распределение по направлениям</div><div id="dew-ch-dest"></div></div>' +
      '<div class="card" style="padding:14px"><div class="card-title">Объём по насосам (всё время)</div><div id="dew-ch-pumps"></div></div>' +
      '<div class="card" style="padding:14px"><div class="card-title">Сравнение зумпфов (3 месяца)</div><div id="dew-ch-sumps"></div></div>' +
    '</div>';

  document.getElementById('dew-af-quarry').addEventListener('change', function() {
    _dewAFilter.quarry = this.value;
    _dewAFilter.sumpId = '';
    var sf = document.getElementById('dew-af-sump');
    if (sf) sf.innerHTML = anlSumpOpts(this.value);
    _dewChartTrend(); _dewChartDest(); _dewChartPumps(); _dewChartSumps();
  });
  document.getElementById('dew-af-sump').addEventListener('change', function() {
    _dewAFilter.sumpId = this.value;
    _dewChartTrend(); _dewChartDest(); _dewChartPumps(); _dewChartSumps();
  });

  _dewChartTrend(); _dewChartDest(); _dewChartPumps(); _dewChartSumps();
}

function _dewAFilteredPumpIds() {
  if (_dewAFilter.sumpId) {
    return DewateringState.pumpsOfSump(_dewAFilter.sumpId).map(function(p) { return p.id; });
  }
  if (_dewAFilter.quarry) {
    var qs = DewateringState.sumps.filter(function(s) { return (s.quarry || '') === _dewAFilter.quarry; });
    return qs.reduce(function(acc, s) {
      return acc.concat(DewateringState.pumpsOfSump(s.id).map(function(p) { return p.id; }));
    }, []);
  }
  return null; // null = all pumps
}

function _dewChartTrend() {
  var el = document.getElementById('dew-ch-trend');
  if (!el) return;
  var days = [];
  for (var i = 29; i >= 0; i--) { var d = new Date(); d.setDate(d.getDate()-i); days.push(d.toISOString().slice(0,10)); }

  var pids = _dewAFilteredPumpIds();
  var data = days.map(function(day) {
    var vol = DewateringState.meterReadings
      .filter(function(r){ return r.date===day && (!pids || pids.indexOf(r.pumpId) >= 0); })
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
  var pids = _dewAFilteredPumpIds();
  var byDest = {};
  DewateringState.meterReadings.forEach(function(r) {
    if (pids && pids.indexOf(r.pumpId) < 0) return;
    var vol   = DewateringState.computedVolume(r) || 0;
    if (!vol) return;
    DewateringState.getDistributions(r).forEach(function(d) {
      if (!d.destinationId) return;
      byDest[d.destinationId] = (byDest[d.destinationId] || 0) + vol * d.pct / 100;
    });
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
  var pids = _dewAFilteredPumpIds();
  var pumps = DewateringState.pumps.filter(function(p) { return !pids || pids.indexOf(p.id) >= 0; })
    .slice().sort(function(a,b){return DewateringState.totalVolumePump(b.id)-DewateringState.totalVolumePump(a.id);});
  if (!pumps.length) { el.innerHTML='<p style="color:var(--txt-3);font-size:11px;text-align:center;padding:20px">Нет данных</p>'; return; }
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
  var filteredSumps = DewateringState.sumps.filter(function(s) {
    if (_dewAFilter.sumpId && s.id !== _dewAFilter.sumpId) return false;
    if (_dewAFilter.quarry && (s.quarry || '') !== _dewAFilter.quarry) return false;
    return true;
  });
  if (!filteredSumps.length) { el.innerHTML='<p style="color:var(--txt-3);font-size:11px;text-align:center;padding:20px">Нет данных по фильтру</p>'; return; }
  var rows=filteredSumps.map(function(sump,si){
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
