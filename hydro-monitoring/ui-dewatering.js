// ── Карьерный водоотлив v2 ───────────────────────────────────

// ── Chart.js global defaults ─────────────────────────────────────
if (typeof Chart !== 'undefined') {
  Chart.defaults.font.family = 'inherit';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = '#b0b8c8';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(18,24,38,0.95)';
  Chart.defaults.plugins.tooltip.titleColor = '#e8eaf0';
  Chart.defaults.plugins.tooltip.bodyColor = '#b0b8c8';
  Chart.defaults.plugins.tooltip.borderColor = 'rgba(255,255,255,0.12)';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.displayColors = true;
  Chart.defaults.plugins.tooltip.boxPadding = 4;
  Chart.defaults.animation.duration = 600;
  Chart.defaults.animation.easing = 'easeOutQuart';
}

var _dewCharts = {}; // registry: chartId -> Chart instance
function _dewDestroyChart(id) {
  if (_dewCharts[id]) { _dewCharts[id].destroy(); delete _dewCharts[id]; }
}

var DewateringState = {
  sumps:                [],  // {id, name, quarry, notes}
  sumpElevationHistory: [],  // {id, sumpId, date, elevation, notes}
  pumps:                [],  // {id, sumpId, name, model, serialNumber, inventoryNumber, quarry, capacity, head, type, status, installDate, notes}
  pumpEvents:           [],  // {id, sumpId, date, type, removedPumpId, installedPumpId, reason, performedBy, notes}
  destinations:         [],  // {id, name, type, targetSumpId}
  meterReadings:        [],  // {id, pumpId, date, reading, isReset, isStopped, downtimeReason, hoursWorked, distributions:[{destinationId,pct}], isManualVolume, manualVolume, notes}
  waterLevels:          [],  // {id, sumpId, date, time, elevation, measuredBy, notes}
  sumpCurveVersions:    [],  // {id, sumpId, validFrom, totalVolume, zMin, zMax, tridbPath, volumeCurve, notes}

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
      this.sumpCurveVersions    = Array.isArray(d.sumpCurveVersions)    ? d.sumpCurveVersions    : [];
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
      this.meterReadings = []; this.waterLevels = []; this.sumpCurveVersions = [];
    }
  },

  save: function() {
    localStorage.setItem('dew_v2', JSON.stringify({
      sumps: this.sumps, sumpElevationHistory: this.sumpElevationHistory,
      pumps: this.pumps, pumpEvents: this.pumpEvents,
      destinations: this.destinations, meterReadings: this.meterReadings,
      waterLevels: this.waterLevels, sumpCurveVersions: this.sumpCurveVersions,
    }));
  },

  loadFromSupabase: async function() {
    if (!window.Api) return false;
    try {
      var results = await Promise.all([
        Api.getDewSumps(), Api.getDewElevations(), Api.getDewPumps(),
        Api.getDewPumpEvents(), Api.getDewDestinations(),
        Api.getDewReadings(), Api.getDewWaterLevels(),
      ]);

      // Логируем каждый сбой, но не прерываем загрузку при частичных ошибках
      var labels = ['dew_sumps','dew_elevation_history','dew_pumps','dew_pump_events','dew_destinations','dew_meter_readings','dew_water_levels'];
      var anyError = false;
      results.forEach(function(r, i) {
        if (r.error) {
          console.error('[dewatering] ошибка загрузки таблицы ' + labels[i] + ':', r.error.message || r.error);
          anyError = true;
        }
      });
      // Если критические таблицы (зумпфы + насосы) недоступны — выходим
      if (results[0].error || results[2].error) {
        console.error('[dewatering] критические таблицы недоступны, отмена загрузки');
        return false;
      }

      this.sumps                = results[0].data.map(rowToDewSump);
      this.sumpElevationHistory = results[1].error ? this.sumpElevationHistory : results[1].data.map(rowToDewElev);

      // ── Sync for pumps ────────────────────────────────────────────────
      // Сервер — источник истины (как и для sumps выше): раньше здесь на КАЖДОЙ
      // загрузке страницы весь локальный список насосов (из localStorage, мог
      // быть устаревшим — с другой вкладки/дня) слепо перезаписывался поверх
      // сервера через upsert. Из-за этого правки другой сессии (например,
      // настроенное "направление откачки по умолчанию") молчаливо затирались
      // назад старыми локальными значениями при следующей загрузке. Теперь
      // локально пушим только то, чего на сервере ещё нет вообще (насос создан
      // только что и, возможно, не успел засинкаться) — существующие на
      // сервере насосы больше не перезатираются локальной копией.
      var remotePumps  = results[2].error ? [] : results[2].data.map(rowToDewPump);
      if (!results[2].error) {
        var remotePumpIds = remotePumps.map(function(p) { return p.id; });
        var orphanPumps = this.pumps.filter(function(p) { return remotePumpIds.indexOf(p.id) === -1; });
        orphanPumps.forEach(function(p) {
          Api.upsertDewPump(dewPumpToRow(p)).catch(function(e) {
            console.warn('[dewatering] failed to push orphan pump to Supabase', p.id, e);
          });
        });
        this.pumps = remotePumps.concat(orphanPumps);
      }

      // ── Bidirectional sync for pump events ───────────────────────────────
      if (!results[3].error) {
        var remoteEvts   = results[3].data.map(rowToDewEvt);
        var remoteEvtIds = remoteEvts.map(function(e) { return e.id; });
        var orphanEvts   = this.pumpEvents.filter(function(e) { return remoteEvtIds.indexOf(e.id) === -1; });
        orphanEvts.forEach(function(e) {
          Api.upsertDewPumpEvent(dewEvtToRow(e)).catch(function(err) {
            console.warn('[dewatering] failed to push orphan pump event to Supabase', e.id, err);
          });
        });
        this.pumpEvents = remoteEvts.concat(orphanEvts);
      }

      // ── Sync for destinations ────────────────────────────────────────────
      // Раньше весь локальный список направлений безусловно пушился поверх
      // сервера при каждой загрузке страницы — из-за этого удалённая (или
      // отредактированная) в одной сессии точка направления "воскресала",
      // если её успела переслать назад устаревшая локальная копия из другой
      // вкладки/дня (localStorage там ещё помнил её как существующую). Здесь,
      // в отличие от насосов выше, сервер теперь ПОЛНОСТЬЮ авторитетен без
      // исключений (как и sumps) — направления создаются/удаляются редко и
      // сразу же синхронизируются в момент действия (addDest/deleteDest), так
      // что подстраховка "дотолкнуть ещё не засинканное" здесь не нужна, а
      // риск повторного воскрешения удалённой точки важнее.
      if (!results[4].error) {
        this.destinations = results[4].data.map(rowToDewDest);
      }
      if (this.destinations.length === 0) this.destinations = _dewDefaultDest();

      // ── Bidirectional sync for meter readings ────────────────────────────
      if (!results[5].error) {
        var finalPumpIds     = this.pumps.map(function(p) { return p.id; });
        var remoteReadings   = results[5].data.map(rowToDewReading);
        var validRemote = [], orphanedInRemote = [];
        remoteReadings.forEach(function(r) {
          if (finalPumpIds.indexOf(r.pumpId) !== -1) { validRemote.push(r); }
          else { orphanedInRemote.push(r); }
        });
        orphanedInRemote.forEach(function(r) {
          Api.deleteDewReading(r.id).catch(function() {});
        });
        var remoteReadingIds = validRemote.map(function(r) { return r.id; });
        var orphanReadings   = this.meterReadings.filter(function(r) { return remoteReadingIds.indexOf(r.id) === -1; });
        orphanReadings.forEach(function(r) {
          Api.upsertDewReading(dewReadingToRow(r)).catch(function(e) {
            console.warn('[dewatering] failed to push orphan reading to Supabase', r.id, e);
          });
        });
        this.meterReadings = validRemote.concat(orphanReadings);
      }

      // ── Bidirectional sync for water levels ──────────────────────────────
      if (!results[6].error) {
        var remoteWL = results[6].data.map(rowToDewLevel);
        if (remoteWL.length > 0) {
          var remoteIds = remoteWL.map(function(w) { return w.id; });
          var orphans   = this.waterLevels.filter(function(w) { return remoteIds.indexOf(w.id) === -1; });
          if (orphans.length) {
            orphans.forEach(function(w) {
              Api.upsertDewLevel(dewLevelToRow(w)).catch(function(e) {
                console.warn('[dewatering] failed to sync orphan water level', w.id, e);
              });
            });
          }
          this.waterLevels = remoteWL;
        } else if (this.waterLevels.length > 0) {
          var self = this;
          this.waterLevels.forEach(function(w) {
            Api.upsertDewLevel(dewLevelToRow(w)).catch(function(e) {
              console.warn('[dewatering] failed to push local water level to Supabase', w.id, e);
            });
          });
        }
      }

      // ── Curve versions: загружаем отдельно — таблица может ещё не существовать ──
      try {
        var cvRes = await Api.getDewSumpCurveVersions();
        if (!cvRes.error && Array.isArray(cvRes.data)) {
          this.sumpCurveVersions = cvRes.data.map(rowToDewSumpCurveVer);
        }
      } catch(cvErr) {
        console.warn('[dewatering] dew_sump_curve_versions not available yet:', cvErr);
      }

      this.save();
      return true;
    } catch(e) { return false; }
  },

  sumpById:    function(id) { return this.sumps.find(function(x) { return x.id === id; }); },
  pumpById:    function(id) { return this.pumps.find(function(x) { return x.id === id; }); },
  destById:    function(id) { return this.destinations.find(function(x) { return x.id === id; }); },
  pumpsOfSump: function(sid) { return this.pumps.filter(function(p) { return p.sumpId === sid; }); },

  // Was this pump already installed as of `date`? (installDate not set = always existed)
  pumpExistsOn: function(pump, date) {
    return !pump.installDate || pump.installDate <= date;
  },

  sumpCurrentElevation: function(sumpId) {
    var hist = this.sumpElevationHistory
      .filter(function(h) { return h.sumpId === sumpId; })
      .sort(function(a, b) { return b.date.localeCompare(a.date); });
    return hist.length ? parseFloat(hist[0].elevation) : null;
  },

  // Отметка дна зумпфа, действовавшая на дату `date` (а не последняя известная) —
  // нужна, чтобы глубина воды для старых замеров считалась от той глубины
  // зумпфа, что была на тот момент, а не задним числом от текущей (зумпф
  // могли углубить/подчистить между старым замером и сегодня).
  sumpElevationAsOf: function(sumpId, date) {
    var hist = this.sumpElevationHistory
      .filter(function(h) { return h.sumpId === sumpId && h.date <= date; })
      .sort(function(a, b) { return b.date.localeCompare(a.date); });
    if (hist.length) return parseFloat(hist[0].elevation);
    var earliest = this.sumpElevationHistory
      .filter(function(h) { return h.sumpId === sumpId; })
      .sort(function(a, b) { return a.date.localeCompare(b.date); });
    return earliest.length ? parseFloat(earliest[0].elevation) : null;
  },

  readingForDate: function(pumpId, date) {
    return this.meterReadings.find(function(r) { return r.pumpId === pumpId && r.date === date; }) || null;
  },

  waterLevelFor: function(sumpId, date) {
    return this.waterLevels.find(function(w) { return w.sumpId === sumpId && w.date === date; }) || null;
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
        return r.pumpId === pumpId && r.date < date && !r.isStopped && (r.reading != null || r.isReset);
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
    if (rec.isReset) {
      var endReading = parseFloat(rec.manualVolume);
      return isNaN(endReading) ? 0 : Math.max(0, endReading - (parseFloat(rec.resetStartValue) || 0));
    }
    var prev = this.lastActualReading(rec.pumpId, rec.date);
    if (!prev) return null;
    var baseVal = prev.isReset
      ? (prev.manualVolume != null ? parseFloat(prev.manualVolume) : (parseFloat(prev.resetStartValue) || 0))
      : parseFloat(prev.reading);
    var diff = parseFloat(rec.reading) - baseVal;
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
    var self = this;
    var pumps = this.pumpsOfSump(sumpId).filter(function(p) { return p.status === 'working' && self.pumpExistsOn(p, date); });
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
    if (window.Api) {
      Api.deleteDewPump(id).catch(function() {});
      Api.deleteDewReadingsByPumpId(id).catch(function() {});
    }
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
  updateDest: function(id, fields) {
    var i=this.destinations.findIndex(function(d){return d.id===id;});
    if (i<0) return;
    Object.assign(this.destinations[i], fields);
    this.save();
    if (window.Api) Api.upsertDewDest(dewDestToRow(this.destinations[i])).catch(function() {});
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
    if (window.Api) Api.upsertDewLevel(dewLevelToRow(d)).catch(function(e) {
      console.error('[dewatering] Supabase: не удалось сохранить замер уровня', d.id, e);
      if (window.Toast) Toast.show('⚠️ Замер сохранён локально, но не синхронизирован с сервером', 'warning');
    });
    return d;
  },
  updateWaterLevel: function(id, d) {
    var i=this.waterLevels.findIndex(function(w){return w.id===id;});
    if(i>=0){ this.waterLevels[i]=Object.assign({},this.waterLevels[i],d); this.save();
      if (window.Api) Api.upsertDewLevel(dewLevelToRow(this.waterLevels[i])).catch(function(e) {
        console.error('[dewatering] Supabase: не удалось обновить замер уровня', id, e);
        if (window.Toast) Toast.show('⚠️ Изменение сохранено локально, но не синхронизировано с сервером', 'warning');
      }); }
  },
  deleteWaterLevel: function(id) {
    this.waterLevels=this.waterLevels.filter(function(w){return w.id!==id;}); this.save();
    if (window.Api) Api.deleteDewLevel(id).catch(function(e) {
      console.error('[dewatering] Supabase: не удалось удалить замер уровня', id, e);
      if (window.Toast) Toast.show('⚠️ Замер удалён локально, но не удалён с сервера', 'warning');
    });
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
  zif:              { label: 'ЗИФ',                     icon: '🏭', color: '#3b82f6' },
  settler:          { label: 'Отстойник / пруд',        icon: '💧', color: '#22d3ee' },
  reservoir:        { label: 'Накопитель',              icon: '🏗', color: '#f97316' },
  relief:           { label: 'Рельеф',                  icon: '🌄', color: '#ef4444' },
  intermediate_sump:{ label: 'Промежуточный зумпф',    icon: '↕',  color: '#22c55e' },
  internal:         { label: 'Внутри карьера',          icon: '→',  color: '#a855f7' },
  reuse:            { label: 'Повторное использование', icon: '♻',  color: '#10b981' },
  outside:          { label: 'За карьер',               icon: '⇥',  color: '#f59e0b' },
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
var _dewJFilter         = { quarry: '', sumpId: '', date: '', histDateFrom: '', histDateTo: '' };
var _dewLFilter         = { quarry: '', sumpId: '' };
var _dewAFilter         = { quarry: '', sumpId: '', days: 30, dateFrom: '', dateTo: '' };
// null = all; array of IDs = only these included in analytics
var _dewAnlSettings     = { includedSumpIds: null, includedPumpIds: null };
(function() {
  try { var s = localStorage.getItem('dew_anl_settings'); if (s) _dewAnlSettings = JSON.parse(s); } catch(e) {}
})();
var _dewShowPumpRegistry = false;
var _dewEditReadingId    = null;
var _dewEditLevelId      = null;
var _dewPumpsCollapsed   = true;
var _dewDestsCollapsed   = true;

// Общие хелперы карьеров/направлений — используются и вкладками
// Обзор/Зумпфы/Журнал, и блок-схемой (ui-dewatering-diagram.js).
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
function _dewDestColor(dest) {
  if (dest && dest.color) return dest.color;
  var info = dest && DEW_DEST_TYPE[dest.type];
  return (info && info.color) || '#6b7280';
}
// Возвращает { 'pumpId→targetNodeId': { pumpId, targetNodeId, volDate, volTotal } }
// volDate = объём в диапазоне dateFrom..dateTo; volTotal = за всё время.
function _dewDiagramComputeFlows(dateFrom, dateTo) {
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
// Цвета темы (тёмная/светлая) для блок-схемы — SVG-рёбрам нужны конкретные
// rgba-строки, а не var(...), поэтому не просто CSS-переменные приложения.
function _dewGetThemeColors() {
  var isLight = document.documentElement.getAttribute('data-theme') === 'light';
  if (isLight) {
    return {
      bg:           'var(--bg-1, #ffffff)',
      canvasBg:     'transparent',
      nodeSump:     { bg:'rgba(255,255,255,0.98)', border:'rgba(37,99,235,0.35)',  header:'rgba(37,99,235,0.65)' },
      nodePump:     { bg:'rgba(255,255,255,0.98)', border:'rgba(37,99,235,0.2)',   header:null },
      nodeDest:     { bg:'rgba(255,255,255,0.98)', border:'rgba(5,150,105,0.35)',  header:'rgba(5,150,105,0.65)' },
      nodeNozzle:   { bg:'rgba(240,253,255,0.98)', border:'rgba(8,145,178,0.5)',   header:'rgba(8,145,178,0.65)' },
      edgeFlow:     'rgba(146,64,14,0.85)',
      edgeStruct:   'rgba(37,99,235,0.45)',
      edgeNozzle:   'rgba(8,145,178,0.75)',
      arrowFlow:    'rgba(146,64,14,1)',
      arrowStruct:  'rgba(37,99,235,0.65)',
      arrowNozzle:  'rgba(8,145,178,0.9)',
      labelText:    'rgba(15,23,42,0.8)',
      quarryBg:     ['rgba(37,99,235,0.06)','rgba(5,150,105,0.06)','rgba(217,119,6,0.05)','rgba(139,92,246,0.05)','rgba(239,68,68,0.05)'],
      quarryBorder: ['rgba(37,99,235,0.22)','rgba(5,150,105,0.2)','rgba(217,119,6,0.2)','rgba(139,92,246,0.2)','rgba(239,68,68,0.2)'],
      quarryLabel:  ['rgba(37,99,235,0.75)','rgba(5,150,105,0.75)','rgba(217,119,6,0.8)','rgba(139,92,246,0.75)','rgba(239,68,68,0.75)'],
    };
  }
  return {
    bg:           'var(--bg-1, #0d1117)',
    canvasBg:     'transparent',
    nodeSump:     { bg:'rgba(12,20,35,0.95)', border:'rgba(88,166,255,0.45)', header:'rgba(88,166,255,0.6)' },
    nodePump:     { bg:'rgba(12,20,35,0.9)',  border:'rgba(88,166,255,0.2)',  header:null },
    nodeDest:     { bg:'rgba(10,28,20,0.95)', border:'rgba(74,222,128,0.4)',  header:'rgba(74,222,128,0.55)' },
    nodeNozzle:   { bg:'rgba(8,25,35,0.95)',  border:'rgba(34,211,238,0.45)', header:'rgba(34,211,238,0.55)' },
    edgeFlow:     'rgba(251,191,36,0.75)',
    edgeStruct:   'rgba(88,166,255,0.35)',
    edgeNozzle:   'rgba(34,211,238,0.6)',
    arrowFlow:    'rgba(251,191,36,0.9)',
    arrowStruct:  'rgba(88,166,255,0.5)',
    arrowNozzle:  'rgba(34,211,238,0.7)',
    labelText:    'rgba(255,255,255,0.7)',
    quarryBg:     ['rgba(88,166,255,0.04)','rgba(74,222,128,0.04)','rgba(251,191,36,0.03)','rgba(188,140,255,0.03)','rgba(248,81,73,0.03)'],
    quarryBorder: ['rgba(88,166,255,0.15)','rgba(74,222,128,0.12)','rgba(251,191,36,0.1)','rgba(188,140,255,0.1)','rgba(248,81,73,0.1)'],
    quarryLabel:  ['rgba(88,166,255,0.8)','rgba(74,222,128,0.75)','rgba(251,191,36,0.8)','rgba(188,140,255,0.75)','rgba(248,81,73,0.8)'],
  };
}

// ── CSS injection for nav-rail redesign ──────────────────────
(function() {
  var style = document.createElement('style');
  style.id = 'dew-rail-css';
  style.textContent = [
    /* Shell layout */
    '#page-dewatering{padding:0!important;overflow:hidden!important}',
    '#page-dewatering.active{display:flex!important;flex-direction:column}',
    '.dew-shell{display:flex;flex:1;overflow:hidden;height:100%}',

    /* Nav rail */
    '.dew-rail{display:flex;flex-direction:column;width:52px;min-width:52px;background:var(--bg-2);border-right:1px solid var(--line);transition:width .22s cubic-bezier(.4,0,.2,1);overflow:hidden;gap:2px;padding:6px 4px;z-index:10;flex-shrink:0}',
    '.dew-rail:hover{width:196px}',

    /* Rail items — base styles live in styles.css to avoid ordering issues */

    /* Rail icon */
    '.dew-rail-icon{width:20px;height:20px;flex-shrink:0;stroke:currentColor}',

    /* Rail label — hidden until rail expands */
    '.dew-rail-label{font-size:12px;font-weight:500;opacity:0;transition:opacity .15s .05s;pointer-events:none;overflow:hidden;text-overflow:ellipsis}',
    '.dew-rail:hover .dew-rail-label{opacity:1}',

    /* Badge */
    '.dew-rail-badge{position:absolute;top:6px;left:24px;min-width:14px;height:14px;border-radius:7px;background:var(--bad);color:#fff;font-size:9px;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 3px;line-height:1}',
    '.dew-rail-badge:not(:empty){display:flex}',

    /* Separator */
    '.dew-rail-sep{height:1px;background:var(--line);margin:4px 4px;flex-shrink:0}',

    /* Content area */
    '.dew-content{flex:1;overflow-y:auto;padding:16px 20px;min-width:0}',

    /* Panel visibility */
    '.dew-panel{display:none}',
    '.dew-panel.active{display:block}',

    /* Journal spreadsheet table (Variant B) */
    '.dew-ss-wrap{overflow-x:auto;border-radius:10px;border:1px solid var(--line)}',
    '.dew-ss{width:100%;border-collapse:collapse;font-size:12px;min-width:700px}',
    '.dew-ss thead tr{background:var(--bg-2);border-bottom:2px solid var(--line)}',
    '.dew-ss thead th{padding:8px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3);white-space:nowrap;text-align:left}',
    '.dew-ss thead th:not(:first-child){border-left:1px solid var(--line-2)}',
    '.dew-ss tbody tr{border-bottom:1px solid var(--line-2);transition:background .12s}',
    '.dew-ss tbody tr:hover{background:var(--bg-2)}',
    '.dew-ss tbody tr.dew-ss-sump-hdr{background:var(--bg-3);border-top:2px solid var(--line)}',
    '.dew-ss tbody tr.dew-ss-stopped{opacity:.65}',
    '.dew-ss td{padding:7px 10px;vertical-align:middle}',
    '.dew-ss td:not(:first-child){border-left:1px solid var(--line-2)}',
    '.dew-ss td input[type=number],.dew-ss td input[type=text]{background:transparent;border:none;outline:none;width:100%;font-size:12px;color:var(--txt-1);font-family:inherit;font-variant-numeric:tabular-nums}',
    '.dew-ss td input[type=number]:focus,.dew-ss td input[type=text]:focus{background:rgba(59,130,246,.15);border-radius:4px;padding:2px 4px;margin:-2px -4px}',
    '.dew-ss td.dew-ss-input{background:rgba(59,130,246,.05)}',
    '.dew-ss tbody tr:hover td.dew-ss-input{background:rgba(59,130,246,.09)}',
    '.dew-ss-dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0}',

    /* Day summary strip */
    '.dew-day-kpi{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;background:var(--bg-2);border:1px solid var(--line-2);border-radius:10px;padding:12px 16px;margin-bottom:14px;align-items:center}',
    '@media(max-width:900px){.dew-day-kpi{grid-template-columns:repeat(3,1fr)}}',
    '@media(max-width:600px){.dew-day-kpi{grid-template-columns:repeat(2,1fr)}}',
  ].join('\n');
  if (!document.getElementById('dew-rail-css')) document.head.appendChild(style);
})();

// ── Init ─────────────────────────────────────────────────────

function initDewateringTab() {
  DewateringState.load(); // immediate localStorage
  // Eagerly load DustState so nozzle hexagons appear on the diagram even before
  // the user has opened the Dust Suppression tab for the first time.
  if (typeof DustState !== 'undefined' && typeof DustState.load === 'function') {
    DustState.load();
  }
  if (!_dewInited) {
    _dewInited = true;
    document.querySelectorAll('.dew-rail-item[data-dew-tab]').forEach(function(btn) {
      btn.addEventListener('click', function() { _dewSwitch(this.dataset.dewTab); });
    });
    // Async Supabase load — re-render when done
    DewateringState.loadFromSupabase().then(function(ok) {
      if (ok) { _dewSwitch(_dewSubTab); _dewUpdateJournalBadge(); }
    });
  }
  _dewSwitch(_dewSubTab);
  _dewUpdateJournalBadge();
}

function _dewSwitch(tab) {
  _dewSubTab = tab;
  // Rail items
  document.querySelectorAll('.dew-rail-item[data-dew-tab]').forEach(function(b) {
    b.classList.toggle('active', b.dataset.dewTab === tab);
  });
  // Panels
  document.querySelectorAll('.dew-panel').forEach(function(p) {
    p.classList.toggle('active', p.id === 'dew-panel-' + tab);
  });
  // Scroll content to top on tab change
  var content = document.querySelector('.dew-content');
  if (content) content.scrollTop = 0;
  if (tab === 'overview')  _dewRenderOverview();
  if (tab === 'sumps')     _dewRenderSumps();
  if (tab === 'journal')   _dewRenderJournal();
  if (tab === 'levels')    _dewRenderLevels();
  if (tab === 'analytics') _dewRenderAnalytics();
}

function _dewUpdateJournalBadge() {
  var badge = document.getElementById('dew-rail-badge-journal');
  if (!badge) return;
  var today = new Date().toISOString().slice(0, 10);
  var pumps = DewateringState.pumps.filter(function(p) { return p.status === 'working' || p.status === 'standby'; });
  var missing = pumps.filter(function(p) { return !DewateringState.readingForDate(p.id, today); }).length;
  badge.textContent = missing > 0 ? String(missing) : '';
}

// ── Обзор ────────────────────────────────────────────────────

// Обзор — теперь только блок-схема водного баланса. KPI-плашки и карточки
// зумпфов раньше дублировали то, что уже есть в других вкладках: статус
// заполнения — в "Журнале" (там же и правится), сводные цифры — в
// "Аналитике", глубина/зеркало воды по зумпфу — прямо на самой схеме
// (карточка узла-зумпфа). Клик по узлу-зумпфу на схеме переносит в
// "Журнал" с фильтром на этот зумпф — так же быстро, как раньше кнопка
// "Заполнить данные", просто без отдельной, дублирующей форму ввода.
function _dewRenderOverview() {
  var el = document.getElementById('dew-panel-overview');
  if (!el) return;

  if (!DewateringState.sumps.length) {
    el.innerHTML = '<div class="card" style="padding:24px;text-align:center;color:var(--txt-3);font-size:13px">Зумпфы не добавлены — перейдите на вкладку <b>Зумпфы</b></div>';
    return;
  }

  el.innerHTML = '<div class="card" style="padding:14px" id="dew-diagram-wrap"></div>';
  _dewRenderDiagram(document.getElementById('dew-diagram-wrap'));
}

// Клик по узлу-зумпфу на схеме → вкладка "Журнал", отфильтрованная на
// этот зумпф (и его карьер, чтобы фильтры были согласованы между собой).
function _dewJumpToSumpJournal(sumpId) {
  var sump = DewateringState.sumpById(sumpId);
  if (!sump) return;
  // Схема на весь экран — сначала закрыть, иначе оверлей останется поверх Журнала.
  if (typeof DewDiag !== 'undefined' && DewDiag.fullscreen && typeof dewDiagToggleFullscreen === 'function') {
    dewDiagToggleFullscreen();
  }
  _dewJFilter.quarry = sump.quarry || '';
  _dewJFilter.sumpId = sumpId;
  _dewSwitch('journal');
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

function _dewGoToLevels(sumpId) {
  _dewLFilter.sumpId = sumpId || '';
  _dewSwitch('levels');
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
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        '<button class="btn btn-sm btn-outline" style="font-size:10px;padding:2px 8px" onclick="_dewOpenElevationHistory(\'' + s.id + '\')">' +
          '📜 История отметок (' + hist.length + ')' +
        '</button>' +
        '<button class="btn btn-sm btn-outline" style="font-size:10px;padding:2px 8px;color:var(--blue);border-color:var(--blue)" onclick="_dewGoToLevels(\'' + s.id + '\')">' +
          '≈ Уровни воды' +
        '</button>' +
      '</div>' +
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
    '<div style="margin-top:10px;padding:10px 12px;border:1px solid var(--line);border-radius:6px">' +
      '<div style="font-size:10px;font-weight:600;color:var(--txt-2);margin-bottom:6px">Направление откачки по умолчанию</div>' +
      '<p style="font-size:10px;color:var(--txt-3);margin:0 0 8px">Будет предзаполнено при вводе показаний. Можно изменить вручную.</p>' +
      _dewDistBlock('pf-default') +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:10px">' +
    '<button class="btn btn-sm" style="background:var(--gold);color:#000" id="dew-pf-save">Сохранить</button>' +
    '<button class="btn btn-sm btn-outline" id="dew-pf-cancel">Отмена</button>' +
    '</div></div>';

  _dewInitDistRows('pf-default', p ? (p.defaultDistributions || []) : []);

  formEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
      defaultDistributions: _dewGetDistributions('pf-default'),
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
      var clr = _dewDestColor(d);
      return '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-3);border-radius:var(--r-sm);font-size:12px;border-left:3px solid ' + clr + '">' +
        '<div style="width:10px;height:10px;border-radius:50%;background:' + clr + ';flex-shrink:0"></div>' +
        '<span style="flex:1;color:var(--txt-1)">' + escHTML(d.name) + '</span>' +
        '<span style="color:var(--txt-3);font-size:10px">' + escHTML(tp.label || d.type || '') + (targetSump ? ' → ' + escHTML(targetSump.name) : '') + '</span>' +
        '<button class="btn btn-sm btn-outline" style="font-size:10px;padding:2px 6px" onclick="_dewOpenDestForm(\'' + d.id + '\')">✎</button>' +
        '<button class="btn btn-sm" style="font-size:10px;padding:2px 6px;background:rgba(248,113,113,.1);color:var(--bad);border:1px solid rgba(248,113,113,.2)" onclick="_dewDeleteDest(\'' + d.id + '\')">✕</button>' +
      '</div>';
    }).join('') + '</div>';
}

function _dewOpenDestForm(editId) {
  var formEl = document.getElementById('dew-dest-form');
  if (!formEl) return;
  var existing = editId ? DewateringState.destById(editId) : null;
  var typeOpts = Object.keys(DEW_DEST_TYPE).map(function(k) {
    var selected = existing && existing.type === k ? ' selected' : '';
    return '<option value="' + k + '"' + selected + '>' + DEW_DEST_TYPE[k].label + '</option>';
  }).join('');
  var sumpOpts = '<option value="">— не указан —</option>' + DewateringState.sumps.map(function(s) {
    var selected = existing && existing.targetSumpId === s.id ? ' selected' : '';
    return '<option value="' + s.id + '"' + selected + '>' + escHTML(s.name) + '</option>';
  }).join('');
  var currentColor = existing ? _dewDestColor(existing) : '#3b82f6';
  var currentType  = existing ? (existing.type || 'zif') : 'zif';

  formEl.innerHTML =
    '<div class="card" style="padding:12px;margin-top:8px;border:1px solid var(--line)">' +
    '<div style="display:grid;grid-template-columns:1fr 1fr auto auto auto;gap:8px;align-items:flex-end">' +
    _dewFld('Название', 'text', 'dew-df-name', existing ? existing.name : '', 'Отстойник №2') +
    '<div class="form-group"><label class="form-label">Тип</label><select id="dew-df-type" class="form-control" onchange="_dewDestTypeChanged()">' + typeOpts + '</select></div>' +
    '<div class="form-group" id="dew-df-sump-wrap" style="display:' + (currentType === 'intermediate_sump' ? 'block' : 'none') + '"><label class="form-label">Целевой зумпф</label><select id="dew-df-sump" class="form-control">' + sumpOpts + '</select></div>' +
    '<div class="form-group"><label class="form-label">Цвет</label><input type="color" id="dew-df-color" value="' + escAttr(currentColor) + '" style="width:48px;height:32px;padding:2px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--bg-3);cursor:pointer"></div>' +
    '<div style="padding-bottom:4px;display:flex;gap:6px">' +
    '<button class="btn btn-sm" style="background:var(--gold);color:#000" id="dew-df-save">' + (existing ? 'Сохранить' : 'Добавить') + '</button>' +
    '<button class="btn btn-sm btn-outline" id="dew-df-cancel">✕</button>' +
    '</div></div></div>';

  document.getElementById('dew-df-cancel').onclick = function() { formEl.innerHTML = ''; };
  document.getElementById('dew-df-save').onclick = function() {
    var name = document.getElementById('dew-df-name').value.trim();
    if (!name) { Toast.show('Введите название', 'warning'); return; }
    var type = document.getElementById('dew-df-type').value;
    var targetSumpId = type === 'intermediate_sump' ? (document.getElementById('dew-df-sump').value || null) : null;
    var colorEl = document.getElementById('dew-df-color');
    var color = colorEl ? colorEl.value : '';
    // If color matches type default, store empty (means "use type default")
    var typeDefault = DEW_DEST_TYPE[type] ? DEW_DEST_TYPE[type].color : '';
    if (color === typeDefault) color = '';
    if (existing) {
      DewateringState.updateDest(existing.id, { name: name, type: type, targetSumpId: targetSumpId, color: color });
      Toast.show('Направление обновлено', 'success');
    } else {
      DewateringState.addDest({ name: name, type: type, targetSumpId: targetSumpId, color: color });
      Toast.show('Направление добавлено', 'success');
    }
    formEl.innerHTML = '';
    _dewRenderDestList();
    // _dewRenderDiagram сама обновит и полноэкранную копию схемы, если она открыта.
    var dw = document.getElementById('dew-diagram-wrap');
    if (dw) _dewRenderDiagram(dw);
  };
}

function _dewDestTypeChanged() {
  var typeEl = document.getElementById('dew-df-type');
  var type = typeEl ? typeEl.value : '';
  var wrap = document.getElementById('dew-df-sump-wrap');
  if (wrap) wrap.style.display = type === 'intermediate_sump' ? 'block' : 'none';
  // Auto-set color picker to type default when type changes
  var colorEl = document.getElementById('dew-df-color');
  if (colorEl && DEW_DEST_TYPE[type] && DEW_DEST_TYPE[type].color) {
    colorEl.value = DEW_DEST_TYPE[type].color;
  }
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
    // Day KPI strip
    '<div id="dew-jr-day-summary" style="margin-bottom:14px"></div>' +

    // Toolbar
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">' +
      '<button class="btn btn-sm btn-outline" onclick="_dewJrChangeDay(-1)" style="padding:4px 10px;font-size:16px" title="Предыдущий день">‹</button>' +
      '<input type="date" id="dew-jr-date" class="form-control" value="' + escAttr(_dewJFilter.date) + '" style="width:145px;font-size:12px">' +
      '<button class="btn btn-sm btn-outline" onclick="_dewJrChangeDay(1)" style="padding:4px 10px;font-size:16px" title="Следующий день">›</button>' +
      '<div style="width:1px;height:24px;background:var(--line);margin:0 4px"></div>' +
      '<select id="dew-jf-l-quarry" class="form-control" style="width:120px;font-size:12px">' + _dewQuarryOpts(_dewJFilter.quarry) + '</select>' +
      '<select id="dew-jf-l-sump" class="form-control" style="width:140px;font-size:12px">' + jSumpOpts(_dewJFilter.quarry) + '</select>' +
      '<button class="btn btn-sm" style="background:var(--gold);color:#000;font-size:11px;margin-left:auto" id="dew-jr-save-all">Сохранить</button>' +
    '</div>' +

    // Progress bar
    '<div id="dew-jr-progress" style="margin-bottom:12px"></div>' +

    // Spreadsheet entry table
    '<div id="dew-jr-quick"></div>' +

    // History section
    '<div style="margin-top:24px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">' +
        '<span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3)">История</span>' +
        '<div style="flex:1"></div>' +
        '<select id="dew-jf-quarry" class="form-control" style="width:120px;font-size:12px">' + _dewQuarryOpts(_dewJFilter.quarry) + '</select>' +
        '<select id="dew-jf-sump" class="form-control" style="width:140px;font-size:12px">' + jSumpOpts(_dewJFilter.quarry) + '</select>' +
        '<input type="date" id="dew-jr-hist-from" class="form-control" value="' + escAttr(_dewJFilter.histDateFrom || '') + '" style="width:130px;font-size:12px" title="С даты">' +
        '<input type="date" id="dew-jr-hist-to" class="form-control" value="' + escAttr(_dewJFilter.histDateTo || '') + '" style="width:130px;font-size:12px" title="По дату">' +
        '<button class="btn btn-sm btn-outline" style="font-size:11px" onclick="_dewJHistClearDates()" title="Сбросить даты">✕</button>' +
        '<div style="font-size:11px;color:var(--txt-3)" id="dew-jr-summary"></div>' +
      '</div>' +
      '<div id="dew-jr-table"></div>' +
    '</div>';

  _dewRenderDaySummary(_dewJFilter.date);
  _dewRenderJournalProgress(_dewJFilter.date);
  _dewRenderQuickEntry(_dewJFilter.date);
  _dewRenderReadingsTable();

  document.getElementById('dew-jr-date').addEventListener('change', function() {
    _dewJFilter.date = this.value;
    _dewRenderDaySummary(this.value);
    _dewRenderJournalProgress(this.value);
    _dewRenderQuickEntry(this.value);
    _dewRenderReadingsTable();
  });
  document.getElementById('dew-jf-l-quarry').addEventListener('change', function() {
    _dewJFilter.quarry = this.value;
    _dewJFilter.sumpId = '';
    var lSump = document.getElementById('dew-jf-l-sump');
    if (lSump) lSump.innerHTML = jSumpOpts(this.value);
    _dewRenderJournalProgress(_dewJFilter.date);
    _dewRenderQuickEntry(_dewJFilter.date);
  });
  document.getElementById('dew-jf-l-sump').addEventListener('change', function() {
    _dewJFilter.sumpId = this.value;
    _dewRenderJournalProgress(_dewJFilter.date);
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
  document.getElementById('dew-jr-hist-from').addEventListener('change', function() {
    _dewJFilter.histDateFrom = this.value;
    _dewRenderReadingsTable();
  });
  document.getElementById('dew-jr-hist-to').addEventListener('change', function() {
    _dewJFilter.histDateTo = this.value;
    _dewRenderReadingsTable();
  });
  document.getElementById('dew-jr-save-all').addEventListener('click', _dewSaveQuickEntry);
}

// ── Day summary strip ─────────────────────────────────────────
function _dewRenderDaySummary(date) {
  var el = document.getElementById('dew-jr-day-summary');
  if (!el) return;

  var allPumps = DewateringState.pumps.filter(function(p) { return (p.status === 'working' || p.status === 'standby') && DewateringState.pumpExistsOn(p, date); });
  if (!allPumps.length) { el.innerHTML = ''; return; }

  var totalVol = 0, totalHrs = 0, working = 0, stopped = 0, missing = 0;
  allPumps.forEach(function(p) {
    var r = DewateringState.readingForDate(p.id, date);
    if (!r) { missing++; return; }
    if (r.isStopped) { stopped++; return; }
    working++;
    totalVol += DewateringState.computedVolume(r) || 0;
    totalHrs += parseFloat(r.hoursWorked) || 0;
  });
  var total = allPumps.length;
  var filled = working + stopped;
  var pct = total ? Math.round(filled / total * 100) : 0;
  var avgHrs = working > 0 ? (totalHrs / working).toFixed(1) : '—';

  var statusColor = pct === 100 ? 'var(--ok)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)';

  el.innerHTML =
    '<div class="dew-day-kpi">' +
      _dewJKpi('Дата', _dewJFmtDate(date), '') +
      _dewJKpi('Объём за день', totalVol > 0 ? totalVol.toFixed(0) + ' м³' : '—', 'var(--ok)') +
      _dewJKpi('В работе', working + ' нас.', working > 0 ? 'var(--ok)' : 'var(--txt-3)') +
      _dewJKpi('Простой', stopped + ' нас.', stopped > 0 ? 'var(--warn)' : 'var(--txt-3)') +
      _dewJKpi('Ср. часов/нас.', avgHrs + ' ч', 'var(--txt-2)') +
      '<div style="display:flex;flex-direction:column;align-items:center;gap:4px">' +
        '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--txt-3)">Заполнено</div>' +
        '<div style="font-size:22px;font-weight:700;color:' + statusColor + ';line-height:1;font-variant-numeric:tabular-nums">' + pct + '%</div>' +
        '<div style="font-size:9px;color:var(--txt-3)">' + filled + ' / ' + total + '</div>' +
      '</div>' +
    '</div>';
}

function _dewJKpi(label, val, color) {
  return '<div style="display:flex;flex-direction:column;gap:2px">' +
    '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--txt-3)">' + escHTML(label) + '</div>' +
    '<div style="font-size:16px;font-weight:700;color:' + (color || 'var(--txt-1)') + ';line-height:1.2">' + val + '</div>' +
  '</div>';
}

function _dewJFmtDate(iso) {
  if (!iso) return '—';
  var p = iso.split('-');
  return p[2] + '.' + p[1] + '.' + p[0];
}

// ── Completeness progress bar ─────────────────────────────────
function _dewRenderJournalProgress(date) {
  var el = document.getElementById('dew-jr-progress');
  if (!el) return;

  var qFilter = _dewJFilter.quarry, sFilter = _dewJFilter.sumpId;
  var pumps = DewateringState.pumps.filter(function(p) {
    if (p.status !== 'working' && p.status !== 'standby') return false;
    if (!DewateringState.pumpExistsOn(p, date)) return false;
    if (sFilter && p.sumpId !== sFilter) return false;
    if (qFilter) {
      var sump = DewateringState.sumpById(p.sumpId);
      if (!sump || (sump.quarry || '') !== qFilter) return false;
    }
    return true;
  });

  if (!pumps.length) { el.innerHTML = ''; return; }

  var indicators = pumps.map(function(p) {
    var r = DewateringState.readingForDate(p.id, date);
    var state = !r ? 'missing' : r.isStopped ? 'stopped' : 'done';
    var sump = DewateringState.sumpById(p.sumpId);
    var tip = escAttr((sump ? sump.name + ' · ' : '') + p.name + ': ' + (state === 'done' ? 'заполнено' : state === 'stopped' ? 'простой' : 'не заполнено'));
    var bg = state === 'done' ? 'var(--ok)' : state === 'stopped' ? 'var(--warn)' : 'var(--line)';
    return '<div title="' + tip + '" style="flex:1;height:6px;border-radius:3px;background:' + bg + ';min-width:6px;max-width:24px;cursor:default"></div>';
  });

  var done = pumps.filter(function(p) { var r = DewateringState.readingForDate(p.id, date); return r && !r.isStopped; }).length;
  var stp  = pumps.filter(function(p) { var r = DewateringState.readingForDate(p.id, date); return r && r.isStopped; }).length;
  var miss = pumps.length - done - stp;

  el.innerHTML =
    '<div style="margin-bottom:4px;display:flex;gap:4px;align-items:center">' +
      '<span style="font-size:10px;color:var(--txt-3)">Готовность насосов:</span>' +
      '<span style="font-size:10px;color:var(--ok)">' + done + ' введено</span>' +
      (stp  ? '<span style="font-size:10px;color:var(--warn)">· ' + stp  + ' простой</span>' : '') +
      (miss ? '<span style="font-size:10px;color:var(--bad)">· ' + miss + ' не заполнено</span>' : '') +
    '</div>' +
    '<div style="display:flex;gap:2px;flex-wrap:wrap">' + indicators.join('') + '</div>';
}

function _dewJHistClearDates() {
  _dewJFilter.histDateFrom = '';
  _dewJFilter.histDateTo   = '';
  var f = document.getElementById('dew-jr-hist-from');
  var t = document.getElementById('dew-jr-hist-to');
  if (f) f.value = '';
  if (t) t.value = '';
  _dewRenderReadingsTable();
}

function _dewRenderQuickEntry(date) {
  var el = document.getElementById('dew-jr-quick');
  if (!el) return;

  if (!DewateringState.pumps.length) {
    el.innerHTML = '<div class="card" style="padding:24px;text-align:center;color:var(--txt-3);font-size:12px">Насосы не добавлены — перейдите на вкладку Зумпфы</div>';
    return;
  }

  var qFilter = _dewJFilter.quarry, sFilter = _dewJFilter.sumpId;
  var rows = [];
  DewateringState.sumps.forEach(function(sump) {
    if (qFilter && (sump.quarry || '') !== qFilter) return;
    if (sFilter && sump.id !== sFilter) return;
    var pumps = DewateringState.pumpsOfSump(sump.id).filter(function(p) { return (p.status === 'working' || p.status === 'standby') && DewateringState.pumpExistsOn(p, date); });
    if (!pumps.length) return;
    rows.push({ type: 'sump', sump: sump });
    pumps.forEach(function(p) { rows.push({ type: 'pump', pump: p, sump: sump }); });
  });

  if (!rows.length) {
    el.innerHTML = '<div class="card" style="padding:24px;text-align:center;color:var(--txt-3);font-size:12px">Нет активных насосов по выбранному фильтру</div>';
    return;
  }

  var thead =
    '<thead><tr>' +
      '<th style="width:180px">Насос</th>' +
      '<th style="width:120px;color:var(--txt-3)">Пред. показание</th>' +
      '<th style="width:130px">Показание, м³</th>' +
      '<th style="width:90px">Объём, м³</th>' +
      '<th style="width:70px">Часов</th>' +
      '<th style="width:60px">м³/ч</th>' +
      '<th>Направление</th>' +
      '<th style="width:120px">Примечание</th>' +
      '<th style="width:72px;text-align:center">Простой</th>' +
    '</tr></thead>';

  var tbody = '<tbody>';
  rows.forEach(function(row) {
    if (row.type === 'sump') {
      tbody += '<tr class="dew-ss-sump-hdr">' +
        '<td colspan="9" style="padding:6px 10px;font-size:11px;font-weight:600;color:var(--txt-2)">' +
          escHTML(row.sump.name) + (row.sump.quarry ? ' <span style="font-weight:400;color:var(--txt-3);font-size:10px">· ' + escHTML(row.sump.quarry) + '</span>' : '') +
        '</td></tr>';
      return;
    }

    var p = row.pump;
    var existing = DewateringState.readingForDate(p.id, date);
    var prevRec  = DewateringState.lastActualReading(p.id, date);
    var prevVal  = prevRec
      ? (prevRec.isReset
          ? (prevRec.manualVolume != null ? parseFloat(prevRec.manualVolume) : (parseFloat(prevRec.resetStartValue) || 0))
          : parseFloat(prevRec.reading))
      : null;
    var prevDate   = prevRec ? prevRec.date : null;
    var isStopped  = existing ? !!existing.isStopped : false;
    var isReset    = existing ? !!existing.isReset   : false;
    var isManual   = existing ? !!existing.isManualVolume : false;
    var existingVol = (existing && !isStopped && !isReset) ? DewateringState.computedVolume(existing) : null;
    var initRate   = (existingVol != null && existingVol > 0 && existing && parseFloat(existing.hoursWorked) > 0)
      ? (existingVol / parseFloat(existing.hoursWorked)).toFixed(1) : null;
    var rDists = existing ? DewateringState.getDistributions(existing) : (p.defaultDistributions || []);

    // Status dot & label
    var dotColor = !existing ? 'var(--line)' : isReset ? 'var(--gold)' : isManual ? 'var(--blue)' : isStopped ? 'var(--warn)' : 'var(--ok)';
    var statusLabel = !existing ? ''
      : isReset   ? ' <span style="font-size:9px;color:var(--gold)">🔄 замена</span>'
      : isManual  ? ' <span style="font-size:9px;color:var(--blue)">✍ вручную</span>'
      : isStopped ? ' <span style="font-size:9px;color:var(--warn)">простой</span>'
      :              ' <span style="font-size:9px;color:var(--ok)">✓</span>';

    // Prev reading cell
    var prevCell = prevVal != null
      ? '<span style="font-variant-numeric:tabular-nums;color:' + (prevRec && prevRec.isReset ? 'var(--gold)' : 'var(--txt-3)') + '">' +
          parseFloat(prevVal).toFixed(0) +
          (prevDate ? ' <span style="font-size:9px;color:var(--txt-3)">(' + prevDate.slice(5).replace('-','.') + ')</span>' : '') +
        '</span>'
      : '<span style="color:var(--txt-3)">—</span>';

    // Current reading input — if reset mode: show locked state + reset details inline
    var valInput;
    if (isReset) {
      var resetVol = existing && existing.manualVolume != null ? DewateringState.computedVolume(existing) : null;
      valInput =
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<span style="font-size:10px;color:var(--gold);white-space:nowrap">🔄 замена</span>' +
          '<button type="button" style="font-size:9px;padding:1px 5px;background:none;border:1px solid var(--gold);color:var(--gold);border-radius:4px;cursor:pointer;line-height:1.4" onclick="_dewQeToggleReset(\'' + p.id + '\')" title="Отменить замену счётчика">✕</button>' +
        '</div>';
    } else if (isManual) {
      valInput =
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<span style="font-size:10px;color:var(--blue);white-space:nowrap">✍ расходомер не работал</span>' +
          '<button type="button" style="font-size:9px;padding:1px 5px;background:none;border:1px solid var(--blue);color:var(--blue);border-radius:4px;cursor:pointer;line-height:1.4" onclick="_dewQeToggleManual(\'' + p.id + '\')" title="Отменить ручной ввод">✕</button>' +
        '</div>';
    } else {
      valInput =
        '<div style="display:flex;align-items:center;gap:4px">' +
          '<input type="number" id="dew-qe-val-' + p.id + '" value="' + escAttr(existing && !isStopped ? String(existing.reading || '') : '') + '" placeholder="накоп. м³" style="min-width:0;flex:1" oninput="_dewQeCalcVol(\'' + p.id + '\',' + (prevVal != null ? prevVal : 'null') + ')"' + (isStopped ? ' disabled' : '') + '>' +
          (!isStopped ? '<button type="button" id="dew-qe-reset-btn-' + p.id + '" style="font-size:10px;padding:1px 4px;background:none;border:1px solid var(--line);color:var(--txt-3);border-radius:4px;cursor:pointer;line-height:1.4;flex-shrink:0" onclick="_dewQeToggleReset(\'' + p.id + '\')" title="Замена расходомера / сброс показаний">🔄</button>' : '') +
          (!isStopped ? '<button type="button" id="dew-qe-manual-btn-' + p.id + '" style="font-size:10px;padding:1px 4px;background:none;border:1px solid var(--line);color:var(--txt-3);border-radius:4px;cursor:pointer;line-height:1.4;flex-shrink:0" onclick="_dewQeToggleManual(\'' + p.id + '\')" title="Расходомер не работал — ввести объём вручную">✍</button>' : '') +
        '</div>';
    }

    // Volume display
    var volDisp = isStopped
      ? '<span style="color:var(--txt-3)">—</span>'
      : isReset
      ? (function() { var rv = existing ? DewateringState.computedVolume(existing) : null; return rv != null ? '<span style="color:var(--gold);font-variant-numeric:tabular-nums">' + rv.toFixed(0) + '</span>' : '<span style="color:var(--txt-3)">—</span>'; })()
      : isManual
      ? '<input type="number" id="dew-qe-manual-vol-' + p.id + '" value="' + escAttr(existing && existing.manualVolume != null ? String(existing.manualVolume) : '') + '" placeholder="объём, м³" style="width:100%;color:var(--blue);font-weight:600" oninput="_dewQeUpdateRate(\'' + p.id + '\')">'
      : '<span id="dew-qe-vol-' + p.id + '" data-vol="' + escAttr(existingVol != null ? String(existingVol) : '') + '" style="font-variant-numeric:tabular-nums;color:var(--ok)">' +
          (existingVol != null ? existingVol.toFixed(0) : '<span style="color:var(--txt-3)">—</span>') +
        '</span>';

    // Rate display
    var rateDisp = (isStopped || isReset)
      ? '<span style="color:var(--txt-3)">—</span>'
      : '<span id="dew-qe-rate-' + p.id + '" style="color:var(--txt-3)">' + (initRate != null ? initRate : '—') + '</span>';

    // Hours input
    var hrsInput = '<input type="number" id="dew-qe-hrs-' + p.id + '" value="' + escAttr(existing ? String(existing.hoursWorked || '') : '') + '" placeholder="ч" min="0" max="24" style="width:52px" oninput="_dewQeUpdateRate(\'' + p.id + '\')"' + (isStopped ? ' disabled' : '') + '>';

    // Notes input
    var notesInput = '<input type="text" id="dew-qe-notes-' + p.id + '" value="' + escAttr(existing ? existing.notes || '' : '') + '" placeholder="—" style="width:100%"' + (isStopped ? ' disabled' : '') + '>';

    // Distribution
    var distNames = rDists.length
      ? rDists.map(function(d) { var dst = DewateringState.destById(d.destinationId); return dst ? escHTML(dst.name) : '?'; }).join(', ')
      : '—';
    var distCell = '<div style="font-size:11px;color:var(--txt-3);cursor:pointer" onclick="_dewQeToggleDistPanel(\'' + p.id + '\')">' + distNames + '</div>' +
      '<div id="dew-dist-toggle-' + p.id + '" style="display:none">' + _dewDistBlock(p.id) + '</div>';

    tbody += '<tr class="' + (isStopped ? 'dew-ss-stopped' : '') + '" id="dew-ss-row-' + p.id + '">' +
      '<td>' +
        '<div style="display:flex;align-items:center;gap:7px">' +
          '<span class="dew-ss-dot" style="background:' + dotColor + '"></span>' +
          '<span style="font-size:12px;color:var(--txt-1)">' + escHTML(p.name) + '</span>' +
          statusLabel +
        '</div>' +
      '</td>' +
      '<td style="font-size:11px">' + prevCell + '</td>' +
      '<td class="dew-ss-input">' + valInput + '</td>' +
      '<td style="text-align:right">' + volDisp + '</td>' +
      '<td class="dew-ss-input">' + hrsInput + '</td>' +
      '<td style="text-align:right;font-size:11px">' + rateDisp + '</td>' +
      '<td style="font-size:11px">' + distCell + '</td>' +
      '<td class="dew-ss-input">' + notesInput + '</td>' +
      '<td style="text-align:center">' +
        '<input type="checkbox" id="dew-qe-stopped-' + p.id + '"' + (isStopped ? ' checked' : '') + ' onchange="_dewQeToggleStopped(\'' + p.id + '\')" title="Насос не работал">' +
      '</td>' +
    '</tr>';

    // Stopped reason sub-row
    if (isStopped) {
      tbody += '<tr id="dew-ss-reason-' + p.id + '">' +
        '<td colspan="9" style="padding:4px 10px 8px 24px;background:rgba(251,191,36,.04)">' +
          '<span style="font-size:10px;color:var(--txt-3)">Причина простоя:&nbsp;</span>' +
          '<input type="text" id="dew-qe-dreason-' + p.id + '" value="' + escAttr(existing ? existing.downtimeReason || '' : '') + '" placeholder="нет воды, авария, ремонт..." style="font-size:11px;width:300px;border:none;background:transparent;outline:none;color:var(--txt-2)">' +
        '</td>' +
      '</tr>';
    }

    // Reset sub-row (meter replacement fields)
    if (isReset) {
      tbody += '<tr id="dew-ss-reset-' + p.id + '">' +
        '<td colspan="9" style="padding:6px 10px 10px 24px;background:rgba(251,191,36,.06);border-bottom:2px solid rgba(251,191,36,.2)">' +
          '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">' +
            '<div>' +
              '<div style="font-size:9px;color:var(--gold);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Нач. показание нового счётчика, м³</div>' +
              '<input type="number" id="dew-qe-reset-start-' + p.id + '" class="form-control" value="' + escAttr(existing && existing.resetStartValue != null ? String(existing.resetStartValue) : '') + '" placeholder="0" style="width:160px;font-size:13px;font-weight:600">' +
            '</div>' +
            '<div>' +
              '<div style="font-size:9px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Показание на 06:00 (необяз.), м³</div>' +
              '<input type="number" id="dew-qe-reset-vol-' + p.id + '" class="form-control" value="' + escAttr(existing && existing.manualVolume != null ? String(existing.manualVolume) : '') + '" placeholder="—" style="width:130px;font-size:12px">' +
            '</div>' +
            '<div style="font-size:10px;color:var(--txt-3);padding-bottom:6px">Счётчик заменён или обнулён.<br>Объём = показание на 06:00 − нач. показание.</div>' +
          '</div>' +
          // Hidden checkbox for _dewSaveQuickEntry to detect reset state
          '<input type="checkbox" id="dew-qe-reset-chk-' + p.id + '" checked style="display:none">' +
        '</td>' +
      '</tr>';
    }
  });
  tbody += '</tbody>';

  el.innerHTML = '<div class="dew-ss-wrap"><table class="dew-ss">' + thead + tbody + '</table></div>';

  // Init distribution rows
  DewateringState.sumps.forEach(function(sump) {
    DewateringState.pumpsOfSump(sump.id)
      .filter(function(p) { return (p.status === 'working' || p.status === 'standby') && DewateringState.pumpExistsOn(p, date); })
      .forEach(function(p) {
        var ex = DewateringState.readingForDate(p.id, date);
        _dewInitDistRows(p.id, ex ? DewateringState.getDistributions(ex) : (p.defaultDistributions || []));
      });
  });
}

function _dewQeToggleDistPanel(pumpId) {
  var panel = document.getElementById('dew-dist-toggle-' + pumpId);
  if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

function _dewCalcVolDisplay(existing, prevVal) {
  if (!existing) return '<span style="color:var(--txt-3)">—</span>';
  if (existing.isStopped) return '<span style="color:var(--txt-3)">простой</span>';
  if (existing.isReset) {
    var vol = DewateringState.computedVolume(existing);
    return '<span style="color:var(--gold)">🔄 ' + (vol > 0 ? vol.toFixed(0) + ' м³' : 'замена') + '</span>';
  }
  if (existing.isManualVolume) return (parseFloat(existing.manualVolume) || 0).toFixed(0) + ' м³';
  if (prevVal == null) return '<span style="color:var(--txt-3)">нет пред.</span>';
  var diff = parseFloat(existing.reading) - parseFloat(prevVal);
  return diff >= 0 ? diff.toFixed(0) + ' м³' : '<span style="color:var(--bad)">ошибка</span>';
}

function _dewQeCalcVol(pumpId, prevVal) {
  var inp   = document.getElementById('dew-qe-val-' + pumpId);
  var volEl = document.getElementById('dew-qe-vol-' + pumpId);
  if (!inp || !volEl) return;
  var cur = parseFloat(inp.value);
  if (isNaN(cur) || prevVal == null) {
    volEl.innerHTML = '<span style="color:var(--txt-3)">—</span>';
    volEl.dataset.vol = '';
    _dewQeUpdateRate(pumpId);
    return;
  }
  var diff = cur - parseFloat(prevVal);
  volEl.dataset.vol = diff >= 0 ? diff : '';
  volEl.innerHTML = diff >= 0
    ? diff.toFixed(0) + ' м³'
    : '<span style="color:var(--bad)">⚠ ' + diff.toFixed(0) + '</span>';
  _dewQeUpdateRate(pumpId);
}

function _dewQeToggleStopped(pumpId) {
  var chk  = document.getElementById('dew-qe-stopped-' + pumpId);
  if (!chk) return;
  var isStopped = chk.checked;
  // Disable all inputs in this row
  ['dew-qe-val-', 'dew-qe-hrs-', 'dew-qe-notes-'].forEach(function(prefix) {
    var inp = document.getElementById(prefix + pumpId);
    if (inp) inp.disabled = isStopped;
  });
  // Show/hide stopped reason row
  var row = document.getElementById('dew-ss-row-' + pumpId);
  if (row) row.classList.toggle('dew-ss-stopped', isStopped);
  // Toggle reason row — insert after pump row if not present
  var reasonRow = document.getElementById('dew-ss-reason-' + pumpId);
  if (isStopped && !reasonRow && row) {
    var tr = document.createElement('tr');
    tr.id = 'dew-ss-reason-' + pumpId;
    tr.innerHTML = '<td colspan="9" style="padding:4px 10px 8px 24px"><span style="font-size:10px;color:var(--txt-3)">Причина простоя:&nbsp;</span>' +
      '<input type="text" id="dew-qe-dreason-' + pumpId + '" placeholder="нет воды, авария, ремонт..." style="font-size:11px;width:300px;border:none;background:transparent;outline:none;color:var(--txt-2)"></td>';
    row.parentNode.insertBefore(tr, row.nextSibling);
  } else if (!isStopped && reasonRow) {
    reasonRow.remove();
  }
  // Update dot color
  var dot = row ? row.querySelector('.dew-ss-dot') : null;
  if (dot) dot.style.background = isStopped ? 'var(--warn)' : 'var(--line)';
}

function _dewQeToggleReset(pumpId) {
  // Find the pump row and toggle isReset state visually
  // We check if a reset sub-row already exists to determine current state
  var resetRow = document.getElementById('dew-ss-reset-' + pumpId);
  var mainRow  = document.getElementById('dew-ss-row-' + pumpId);
  if (!mainRow) return;

  if (resetRow) {
    // Currently in reset mode → cancel: remove reset row, restore normal input
    resetRow.remove();
    var td = mainRow.querySelector('td:nth-child(3)');
    if (td) {
      // Get prevVal from prev cell text (data-prev stored on row)
      var prevVal = mainRow.dataset.prevVal || 'null';
      td.innerHTML =
        '<div style="display:flex;align-items:center;gap:4px">' +
          '<input type="number" id="dew-qe-val-' + pumpId + '" placeholder="накоп. м³" style="min-width:0;flex:1" oninput="_dewQeCalcVol(\'' + pumpId + '\',' + prevVal + ')">' +
          '<button type="button" style="font-size:10px;padding:1px 4px;background:none;border:1px solid var(--line);color:var(--txt-3);border-radius:4px;cursor:pointer;line-height:1.4;flex-shrink:0" onclick="_dewQeToggleReset(\'' + pumpId + '\')" title="Замена расходомера / сброс показаний">🔄</button>' +
        '</div>';
    }
    // Restore dot to grey/missing state
    var dot = mainRow.querySelector('.dew-ss-dot');
    if (dot) dot.style.background = 'var(--line)';
    // Clear status label (4th child of pump name cell)
    var nameCell = mainRow.querySelector('td:first-child');
    if (nameCell) {
      var lbl = nameCell.querySelector('span:last-child');
      if (lbl && lbl.style.color && lbl.style.color.indexOf('gold') >= 0) lbl.remove();
    }
  } else {
    // Enter reset mode: lock reading input, show reset sub-row
    var td3 = mainRow.querySelector('td:nth-child(3)');
    if (td3) {
      td3.innerHTML =
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<span style="font-size:10px;color:var(--gold);white-space:nowrap">🔄 замена</span>' +
          '<button type="button" style="font-size:9px;padding:1px 5px;background:none;border:1px solid var(--gold);color:var(--gold);border-radius:4px;cursor:pointer;line-height:1.4" onclick="_dewQeToggleReset(\'' + pumpId + '\')" title="Отменить замену счётчика">✕</button>' +
        '</div>';
    }
    // Update dot to gold
    var dot2 = mainRow.querySelector('.dew-ss-dot');
    if (dot2) dot2.style.background = 'var(--gold)';

    // Insert reset sub-row after main row (and after any existing reason row)
    var insertAfter = document.getElementById('dew-ss-reason-' + pumpId) || mainRow;
    var tr = document.createElement('tr');
    tr.id = 'dew-ss-reset-' + pumpId;
    tr.innerHTML =
      '<td colspan="9" style="padding:6px 10px 10px 24px;background:rgba(251,191,36,.06);border-bottom:2px solid rgba(251,191,36,.2)">' +
        '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">' +
          '<div>' +
            '<div style="font-size:9px;color:var(--gold);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Нач. показание нового счётчика, м³</div>' +
            '<input type="number" id="dew-qe-reset-start-' + pumpId + '" class="form-control" placeholder="0" style="width:160px;font-size:13px;font-weight:600">' +
          '</div>' +
          '<div>' +
            '<div style="font-size:9px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Показание на 06:00 (необяз.), м³</div>' +
            '<input type="number" id="dew-qe-reset-vol-' + pumpId + '" class="form-control" placeholder="—" style="width:130px;font-size:12px">' +
          '</div>' +
          '<div style="font-size:10px;color:var(--txt-3);padding-bottom:6px">Счётчик заменён или обнулён.<br>Объём = показание на 06:00 − нач. показание.</div>' +
        '</div>' +
      '</td>';
    insertAfter.parentNode.insertBefore(tr, insertAfter.nextSibling);
    // Also add hidden checkbox that _dewSaveQuickEntry reads
    var hiddenChk = document.createElement('input');
    hiddenChk.type = 'checkbox';
    hiddenChk.id = 'dew-qe-reset-chk-' + pumpId;
    hiddenChk.checked = true;
    hiddenChk.style.display = 'none';
    tr.appendChild(hiddenChk);
  }
}

function _dewQeToggleManual(pumpId) {
  // Toggle "расходомер не работал" manual-volume entry mode
  var mainRow = document.getElementById('dew-ss-row-' + pumpId);
  if (!mainRow) return;
  var manualChk = document.getElementById('dew-qe-manual-chk-' + pumpId);

  if (manualChk) {
    // Currently in manual mode → cancel: restore normal reading input + volume display
    var prevVal = mainRow.dataset.prevVal || 'null';
    var td3 = mainRow.querySelector('td:nth-child(3)');
    if (td3) {
      td3.innerHTML =
        '<div style="display:flex;align-items:center;gap:4px">' +
          '<input type="number" id="dew-qe-val-' + pumpId + '" placeholder="накоп. м³" style="min-width:0;flex:1" oninput="_dewQeCalcVol(\'' + pumpId + '\',' + prevVal + ')">' +
          '<button type="button" style="font-size:10px;padding:1px 4px;background:none;border:1px solid var(--line);color:var(--txt-3);border-radius:4px;cursor:pointer;line-height:1.4;flex-shrink:0" onclick="_dewQeToggleReset(\'' + pumpId + '\')" title="Замена расходомера / сброс показаний">🔄</button>' +
          '<button type="button" id="dew-qe-manual-btn-' + pumpId + '" style="font-size:10px;padding:1px 4px;background:none;border:1px solid var(--line);color:var(--txt-3);border-radius:4px;cursor:pointer;line-height:1.4;flex-shrink:0" onclick="_dewQeToggleManual(\'' + pumpId + '\')" title="Расходомер не работал — ввести объём вручную">✍</button>' +
        '</div>';
    }
    var td4 = mainRow.querySelector('td:nth-child(4)');
    if (td4) {
      td4.innerHTML = '<span id="dew-qe-vol-' + pumpId + '" data-vol="" style="font-variant-numeric:tabular-nums;color:var(--ok)"><span style="color:var(--txt-3)">—</span></span>';
    }
    _dewQeUpdateRate(pumpId);
    var dot = mainRow.querySelector('.dew-ss-dot');
    if (dot) dot.style.background = 'var(--line)';
    var nameCell = mainRow.querySelector('td:first-child');
    if (nameCell) {
      var lbl = nameCell.querySelector('span:last-child');
      if (lbl && lbl.style.color && lbl.style.color.indexOf('blue') >= 0) lbl.remove();
    }
  } else {
    // Enter manual mode: lock reading input, show manual volume input in place of the volume display
    var td3b = mainRow.querySelector('td:nth-child(3)');
    if (td3b) {
      td3b.innerHTML =
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<span style="font-size:10px;color:var(--blue);white-space:nowrap">✍ расходомер не работал</span>' +
          '<button type="button" style="font-size:9px;padding:1px 5px;background:none;border:1px solid var(--blue);color:var(--blue);border-radius:4px;cursor:pointer;line-height:1.4" onclick="_dewQeToggleManual(\'' + pumpId + '\')" title="Отменить ручной ввод">✕</button>' +
          '<input type="checkbox" id="dew-qe-manual-chk-' + pumpId + '" checked style="display:none">' +
        '</div>';
    }
    var td4b = mainRow.querySelector('td:nth-child(4)');
    if (td4b) {
      td4b.innerHTML = '<input type="number" id="dew-qe-manual-vol-' + pumpId + '" placeholder="объём, м³" style="width:100%;color:var(--blue);font-weight:600" oninput="_dewQeUpdateRate(\'' + pumpId + '\')">';
    }
    _dewQeUpdateRate(pumpId);
    var dot2 = mainRow.querySelector('.dew-ss-dot');
    if (dot2) dot2.style.background = 'var(--blue)';
  }
}

function _dewQeUpdateRate(pumpId) {
  var volEl    = document.getElementById('dew-qe-vol-'  + pumpId);
  var manualEl = document.getElementById('dew-qe-manual-vol-' + pumpId);
  var hrsEl    = document.getElementById('dew-qe-hrs-'  + pumpId);
  var rateEl   = document.getElementById('dew-qe-rate-' + pumpId);
  if (!rateEl) return;
  var vol = manualEl ? parseFloat(manualEl.value) : parseFloat(volEl ? volEl.dataset.vol : '');
  var hrs = parseFloat((hrsEl || {}).value);
  rateEl.innerHTML = (!isNaN(vol) && vol > 0 && !isNaN(hrs) && hrs > 0)
    ? '<span style="color:var(--txt-2)">' + (vol / hrs).toFixed(1) + ' м³/ч</span>'
    : '<span style="color:var(--txt-3)">—</span>';
}

function _dewJrChangeDay(delta) {
  var dateEl = document.getElementById('dew-jr-date');
  if (!dateEl || !dateEl.value) return;
  var p = dateEl.value.split('-').map(Number);
  var d = new Date(p[0], p[1] - 1, p[2]);
  d.setDate(d.getDate() + delta);
  var newDate = d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
  _dewJFilter.date = newDate;
  dateEl.value = newDate;
  _dewRenderDaySummary(newDate);
  _dewRenderJournalProgress(newDate);
  _dewRenderQuickEntry(newDate);
  _dewRenderReadingsTable();
}

function _dewSaveQuickEntry() {
  var date = document.getElementById('dew-jr-date') ? document.getElementById('dew-jr-date').value : _dewJFilter.date;
  if (!date) { Toast.show('Укажите дату', 'warning'); return; }

  var saved = 0;
  DewateringState.pumps.filter(function(p) { return p.status === 'working' || p.status === 'standby'; }).forEach(function(p) {
    var stoppedChk = document.getElementById('dew-qe-stopped-' + p.id);
    if (!stoppedChk) return;

    var isStopped   = stoppedChk.checked;
    var resetChkEl  = document.getElementById('dew-qe-reset-chk-' + p.id);
    var isReset     = !isStopped && !!(resetChkEl && resetChkEl.checked);
    var manualChkEl = document.getElementById('dew-qe-manual-chk-' + p.id);
    var isManual    = !isStopped && !isReset && !!(manualChkEl && manualChkEl.checked);
    var existing    = DewateringState.readingForDate(p.id, date);

    var data = {
      pumpId: p.id,
      date:   date,
      isStopped: isStopped,
      downtimeReason: isStopped ? ((document.getElementById('dew-qe-dreason-' + p.id) || {}).value || '').trim() : '',
      isReset: isReset,
      isManualVolume: isManual,
    };

    if (!isStopped && isReset) {
      var resetStartEl = document.getElementById('dew-qe-reset-start-' + p.id);
      data.resetStartValue = resetStartEl ? (parseFloat(resetStartEl.value) || 0) : 0;
      var resetVolEl = document.getElementById('dew-qe-reset-vol-' + p.id);
      data.manualVolume  = resetVolEl && resetVolEl.value.trim() !== '' ? (parseFloat(resetVolEl.value) || 0) : null;
      data.hoursWorked   = parseFloat((document.getElementById('dew-qe-hrs-'   + p.id) || {}).value) || null;
      data.distributions = _dewGetDistributions(p.id);
      data.notes         = ((document.getElementById('dew-qe-notes-' + p.id) || {}).value || '').trim();
    } else if (!isStopped && isManual) {
      var manualVolEl = document.getElementById('dew-qe-manual-vol-' + p.id);
      if (!manualVolEl || manualVolEl.value.trim() === '') return;
      data.manualVolume  = parseFloat(manualVolEl.value) || 0;
      data.reading       = null;
      data.hoursWorked   = parseFloat((document.getElementById('dew-qe-hrs-'   + p.id) || {}).value) || null;
      data.distributions = _dewGetDistributions(p.id);
      data.notes         = ((document.getElementById('dew-qe-notes-' + p.id) || {}).value || '').trim();
    } else if (!isStopped) {
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
    var p = date.split('-').map(Number);
    var nd = new Date(p[0], p[1] - 1, p[2]);
    nd.setDate(nd.getDate() + 1);
    var nextDate = nd.getFullYear() + '-' +
      String(nd.getMonth() + 1).padStart(2, '0') + '-' +
      String(nd.getDate()).padStart(2, '0');
    _dewJFilter.date = nextDate;
    var dateInp = document.getElementById('dew-jr-date');
    if (dateInp) dateInp.value = nextDate;
    _dewRenderDaySummary(nextDate);
    _dewRenderJournalProgress(nextDate);
    _dewRenderQuickEntry(nextDate);
    _dewUpdateJournalBadge();
  } else {
    Toast.show('Нечего сохранять — введите показания', 'warning');
  }
}

function _dewJStatusBadge(r) {
  if (r.isStopped) return '<div style="font-size:9px;color:var(--warn);margin-top:1px">простой</div>';
  if (r.isReset)   return '<div style="font-size:9px;color:var(--gold);margin-top:1px">замена счётчика</div>';
  if (r.notes)     return '<div style="font-size:9px;color:var(--txt-3);margin-top:1px">' + escHTML(r.notes.slice(0, 40)) + '</div>';
  return '';
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

  var dateFrom = _dewJFilter.histDateFrom || '';
  var dateTo   = _dewJFilter.histDateTo   || '';

  var records = DewateringState.meterReadings
    .filter(function(r) {
      if (pumpsFilter.indexOf(r.pumpId) < 0) return false;
      if (dateFrom && r.date < dateFrom) return false;
      if (dateTo   && r.date > dateTo)   return false;
      return true;
    })
    .sort(function(a, b) { return b.date.localeCompare(a.date) || (b.pumpId || '').localeCompare(a.pumpId || ''); });

  var totalVol = records.reduce(function(a, r) { return a + (DewateringState.computedVolume(r) || 0); }, 0);
  if (sumEl) sumEl.innerHTML = records.length + ' записей · <b style="color:var(--txt-1)">' + totalVol.toFixed(0) + ' м³</b> итого';

  if (!records.length) {
    el.innerHTML = '<div class="card" style="padding:20px;text-align:center;color:var(--txt-3);font-size:12px">' +
      (DewateringState.meterReadings.length ? 'Нет данных по выбранным фильтрам' : 'Журнал пуст — введите первые показания выше') + '</div>';
    return;
  }

  // Group records by date for summary rows
  var dateGroups = {};
  records.forEach(function(r) {
    if (!dateGroups[r.date]) dateGroups[r.date] = [];
    dateGroups[r.date].push(r);
  });

  el.innerHTML = '<div style="overflow-x:auto;max-height:520px;overflow-y:auto">' +
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
    records.map(function(r, idx) {
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
                   : r.isReset   ? '<span style="color:var(--gold)">🔄 ' + (vol != null ? vol.toFixed(0) + ' м³' : '—') + '</span>'
                   : r.isManualVolume ? '<span style="color:var(--blue);font-weight:600">✍ ' + (vol != null ? vol.toFixed(0) : '0') + '</span>'
                   : vol == null  ? '<span style="color:var(--txt-3)">нет пред.</span>'
                   : '<span style="color:var(--ok);font-weight:600">' + vol.toFixed(0) + '</span>';
      var readingDisp = r.isStopped ? '—'
                      : r.isReset   ? '<span style="color:var(--gold)">→ ' + (r.resetStartValue != null ? parseFloat(r.resetStartValue).toFixed(0) : '0') + '</span>'
                      : r.isManualVolume ? '<span style="color:var(--blue)">вручную</span>'
                      : (r.reading != null ? parseFloat(r.reading).toFixed(0) : '—');

      // Insert date group header when date changes
      var isFirstOfDate = idx === 0 || records[idx - 1].date !== r.date;
      var groupHeader = '';
      if (isFirstOfDate) {
        var grp = dateGroups[r.date] || [];
        var dayVol = grp.reduce(function(a, x) { return a + (DewateringState.computedVolume(x) || 0); }, 0);
        var dayWorking = grp.filter(function(x) { return !x.isStopped; }).length;
        var dayStopped = grp.filter(function(x) { return x.isStopped; }).length;
        groupHeader = '<tr style="background:var(--bg-3);border-top:2px solid var(--line)">' +
          '<td colspan="7" style="padding:5px 8px">' +
            '<div style="display:flex;align-items:center;gap:12px">' +
              '<span style="font-size:11px;font-weight:600;color:var(--txt-1)">' + _dewJFmtDate(r.date) + '</span>' +
              '<span style="font-size:10px;color:var(--ok)">' + dayVol.toFixed(0) + ' м³</span>' +
              '<span style="font-size:10px;color:var(--txt-3)">' + dayWorking + ' в работе' + (dayStopped ? ' · ' + dayStopped + ' простой' : '') + '</span>' +
            '</div>' +
          '</td>' +
        '</tr>';
      }

      var dataRow =
        groupHeader +
        '<tr style="border-bottom:' + (isEditing ? 'none' : '1px solid var(--line-2)') + (isEditing ? ';background:rgba(255,255,255,.03)' : r.isReset ? ';background:rgba(251,191,36,.04)' : '') + '">' +
        '<td style="padding:5px 8px;color:var(--txt-3);white-space:nowrap;font-size:10px">' +
          (sump ? '<span style="font-size:9px;color:var(--txt-3)">' + escHTML(sump.name) + '</span>' : '—') +
        '</td>' +
        '<td style="padding:5px 8px">' +
          '<div style="color:var(--txt-1)">' + (pump ? escHTML(pump.name) : '—') + '</div>' +
          _dewJStatusBadge(r) +
        '</td>' +
        '<td style="padding:5px 8px;text-align:right;color:var(--txt-2)">' + readingDisp + '</td>' +
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
  _dewRenderDaySummary(_dewJFilter.date);
  _dewRenderJournalProgress(_dewJFilter.date);
  _dewRenderReadingsTable();
  _dewRenderQuickEntry(_dewJFilter.date);
  _dewUpdateJournalBadge();
  Toast.show('Запись обновлена', 'success');
}

function _dewDeleteReading(id) {
  if (!confirm('Удалить запись показания?')) return;
  DewateringState.deleteReading(id);
  _dewEditReadingId = null;
  _dewRenderDaySummary(_dewJFilter.date);
  _dewRenderJournalProgress(_dewJFilter.date);
  _dewRenderReadingsTable();
  _dewRenderQuickEntry(_dewJFilter.date);
  _dewUpdateJournalBadge();
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
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">' +
          '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3)">Новый замер уровня</div>' +
          '<button class="btn btn-sm btn-outline" style="font-size:10px;padding:3px 7px;white-space:nowrap" onclick="_dewOpenLevelsImportModal()" title="Загрузить уровни сразу по нескольким зумпфам и датам из Excel">📥 Массовая загрузка</button>' +
        '</div>' +
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

  document.getElementById('dew-lv-sump').addEventListener('change', function() {
    _dewLvUpdateDepthHint();
    // Фильтр истории справа и выбор зумпфа в форме слева читают один и тот
    // же _dewLFilter — держим их синхронными здесь же, иначе новый замер
    // сохраняется, но остаётся невидимым под старым фильтром справа.
    var sump = DewateringState.sumpById(this.value);
    _dewLFilter.sumpId = this.value;
    _dewLFilter.quarry = (sump && sump.quarry) || '';
    var qf = document.getElementById('dew-lv-filter-quarry'); if (qf) qf.value = _dewLFilter.quarry;
    var sf = document.getElementById('dew-lv-filter-sump');
    if (sf) sf.innerHTML = lvSumpOpts(_dewLFilter.quarry, false);
    _dewRenderLevelsTable(_dewLFilter.sumpId);
  });
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
      var botElev   = DewateringState.sumpElevationAsOf(w.sumpId, w.date);
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
  var wrap = document.getElementById('dew-lv-chart');
  if (!wrap) return;
  _dewDestroyChart('levels');

  if (!records || !records.length) { wrap.innerHTML = ''; return; }

  var LEVEL_COLORS = ['rgba(34,211,238,1)','rgba(99,179,237,1)','rgba(154,117,232,1)','rgba(251,191,36,1)','rgba(74,222,128,1)','rgba(248,113,113,1)'];

  // Group by sump for multi-sump view
  var grouped = {};
  var sumpOrder = [];
  records.slice().reverse().forEach(function(r) {
    if (!grouped[r.sumpId]) { grouped[r.sumpId] = []; sumpOrder.push(r.sumpId); }
    grouped[r.sumpId].push(r);
  });

  // Collect all unique dates for labels
  var allDates = [];
  var dateSet = {};
  records.forEach(function(r) {
    if (!dateSet[r.date]) { dateSet[r.date] = true; allDates.push(r.date); }
  });
  allDates.sort();
  var labels = allDates.slice(-60).map(function(d) {
    var dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit'});
  });
  var labelDates = allDates.slice(-60);

  var datasets = sumpOrder.map(function(sid, idx) {
    var sump = DewateringState.sumpById(sid);
    var readings = grouped[sid];
    // Map each label date to a value
    var byDate = {};
    readings.forEach(function(r) { byDate[r.date] = parseFloat(r.elevation || 0); });
    var data = labelDates.map(function(d) { return byDate[d] != null ? byDate[d] : null; });
    var color = LEVEL_COLORS[idx % LEVEL_COLORS.length];
    var isSingle = sumpOrder.length === 1;
    return {
      label: sump ? sump.name : sid,
      data: data,
      fill: isSingle,
      backgroundColor: isSingle ? color.replace('1)', '0.2)') : 'transparent',
      borderColor: color,
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 6,
      pointBackgroundColor: color,
      pointBorderColor: 'rgba(18,24,38,0.9)',
      pointBorderWidth: 1.5,
      tension: 0.35,
      spanGaps: true,
    };
  });

  wrap.innerHTML = '<canvas id="dew-canvas-levels"></canvas>';
  var canvas = wrap.querySelector('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '220px';
  var ctx = canvas.getContext('2d');

  _dewCharts['levels'] = new Chart(ctx, {
    type: 'line',
    data: { labels: labels, datasets: datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: sumpOrder.length > 1, position: 'top', labels: { font: {size:11}, boxWidth: 12, padding: 12 } },
        tooltip: {
          callbacks: {
            title: function(items) { return labelDates[items[0].dataIndex] || ''; },
            label: function(item) { return ' ' + item.dataset.label + ': ' + (item.raw != null ? item.raw.toFixed(2) + ' м абс.' : '—'); }
          }
        },
        zoom: {
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
          pan:  { enabled: true, mode: 'x' }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { font: { size: 11 }, maxTicksLimit: 10, maxRotation: 30 }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.06)' },
          ticks: { font: { size: 11 }, callback: function(v) { return v.toFixed(1); } }
        }
      }
    }
  });
}

function _dewDeleteWaterLevel(id) {
  if (!confirm('Удалить замер уровня воды?')) return;
  DewateringState.deleteWaterLevel(id);
  _dewEditLevelId = null;
  _dewRenderLevelsTable(_dewLFilter.sumpId);
}

// ── Массовая загрузка уровней воды (шаблон Excel) ──────────────
// Формат: одна строка = одна дата, один столбец = один зумпф (плюс
// Время/Кто замерил на всю строку). Пустая ячейка = этот замер не
// трогаем; заполненная — создаём запись или обновляем существующую
// на эту дату. Так можно за один файл занести историю сразу по
// нескольким зумпфам за любой период, не по одной записи за раз.

function _dewOpenLevelsImportModal() {
  _dewCloseLevelsImportModal();
  var ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.id = 'dew-lv-import-overlay';
  ov.style.display = 'flex';
  ov.innerHTML =
    '<div class="modal-box" style="width:min(560px,100%)">' +
      '<div class="modal-header">' +
        '<span class="modal-title">Массовая загрузка уровней воды</span>' +
        '<button class="modal-close" onclick="_dewCloseLevelsImportModal()">✕</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--txt-3);margin-bottom:8px">① Скачать шаблон</div>' +
        '<p style="font-size:12px;color:var(--txt-2);margin:0 0 10px;line-height:1.6">В шаблоне уже есть колонка на каждый имеющийся зумпф. Заполните строки по датам за любой период — пустая ячейка означает, что этот замер трогать не нужно.</p>' +
        '<button class="btn btn-sm btn-outline" onclick="_dewDownloadLevelsTemplate()">⬇ Скачать шаблон .xlsx</button>' +
        '<div style="border-top:1px solid var(--line);margin:16px 0"></div>' +
        '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--txt-3);margin-bottom:8px">② Загрузить заполненный файл</div>' +
        '<div style="background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.18);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:11px;color:var(--txt-2);line-height:1.6">' +
          '• Пустая ячейка — замер не создаётся и не меняется<br>' +
          '• Если на эту дату для зумпфа уже есть замер — он обновится, если нет — создастся новый<br>' +
          '• Дата — в формате ДД.ММ.ГГГГ или ГГГГ-ММ-ДД' +
        '</div>' +
        '<input type="file" id="dew-lv-import-file" accept=".xlsx,.xls" class="form-control" style="padding:6px">' +
        '<div id="dew-lv-import-status" style="margin-top:10px;font-size:11px"></div>' +
        '<div style="display:flex;gap:8px;margin-top:16px">' +
          '<button class="btn btn-sm btn-outline" onclick="_dewCloseLevelsImportModal()">Отмена</button>' +
          '<button class="btn btn-sm" style="background:var(--gold);color:#000" onclick="_dewImportLevelsFile()">Импортировать</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  ov.addEventListener('click', function(e) { if (e.target === ov) _dewCloseLevelsImportModal(); });
  document.body.appendChild(ov);
}

function _dewCloseLevelsImportModal() {
  var ov = document.getElementById('dew-lv-import-overlay');
  if (ov) ov.remove();
}

function _dewDownloadLevelsTemplate() {
  if (typeof XLSX === 'undefined') { alert('Библиотека SheetJS не загружена. Проверьте соединение.'); return; }
  if (!DewateringState.sumps.length) { alert('Сначала добавьте хотя бы один зумпф на вкладке "Зумпфы".'); return; }

  var sumps = DewateringState.sumps.slice().sort(function(a, b) {
    var qa = a.quarry || '', qb = b.quarry || '';
    if (qa !== qb) return qa < qb ? -1 : 1;
    return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
  });

  var fixedHeaders = ['Дата (ДД.ММ.ГГГГ)', 'Время', 'Кто замерил'];
  var headerRow  = fixedHeaders.concat(sumps.map(function(s) { return s.name; }));
  var quarryRow  = ['Карьер зумпфа →', '', ''].concat(sumps.map(function(s) { return s.quarry || ''; }));
  var exampleRow = ['#ПРИМЕР', '06:00', 'Иванов И.И.'].concat(sumps.map(function(_, i) { return i === 0 ? 171.15 : ''; }));

  var rows = [
    ['Шаблон замеров уровня воды — оставьте ячейку пустой, если этот замер менять не нужно'],
    quarryRow,
    headerRow,
    exampleRow,
  ];

  var wb = XLSX.utils.book_new();
  var ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 16 }, { wch: 8 }, { wch: 16 }].concat(sumps.map(function() { return { wch: 14 }; }));
  ws['!freeze'] = { xSplit: 3, ySplit: 3, topLeftCell: 'D4', activePane: 'bottomRight', state: 'frozen' };
  XLSX.utils.book_append_sheet(wb, ws, 'Уровни воды');

  var wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  var blob = new Blob([wbOut], { type: 'application/octet-stream' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'dew_water_levels_template.xlsx';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function _dewPad2(n) { return String(n).length < 2 ? '0' + n : String(n); }

// Принимает то, что реально приходит из XLSX.read(..., {cellDates:true}) +
// sheet_to_json(..., {raw:true}): чаще всего JS Date (Excel сам распознал
// введённую дату), реже — голое число (серийная дата) или строка (если
// ячейку явно ввели как текст). Даты сравниваются геттерами локального
// времени (getFullYear/Month/Date), а не UTC — SheetJS строит Date из
// серийного номера как локальную полночь, так что UTC-геттеры на день
// ошибались бы для любого часового пояса восточнее UTC.
function _dewParseImportDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return v.getFullYear() + '-' + _dewPad2(v.getMonth() + 1) + '-' + _dewPad2(v.getDate());
  }
  if (typeof v === 'number') {
    // Серийная дата Excel не была распознана как дата (не должно случаться
    // при cellDates:true, но на всякий случай) — 25569 = разница в днях
    // между эпохой Excel (1899-12-30) и Unix-эпохой.
    var d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.getUTCFullYear() + '-' + _dewPad2(d.getUTCMonth() + 1) + '-' + _dewPad2(d.getUTCDate());
  }
  var str = String(v).trim();
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) {
    var p = str.split('.');
    return p[2] + '-' + p[1] + '-' + p[0];
  }
  var m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[1] + '-' + m[2] + '-' + m[3]) : null;
}

// Время могло тоже попасть под авто-распознавание Excel и прийти как доля
// суток (число) или как Date — приводим оба случая к "ЧЧ:ММ".
function _dewParseImportTime(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return _dewPad2(v.getHours()) + ':' + _dewPad2(v.getMinutes());
  }
  if (typeof v === 'number') {
    var totalMin = Math.round(v * 24 * 60);
    return _dewPad2(Math.floor(totalMin / 60) % 24) + ':' + _dewPad2(totalMin % 60);
  }
  return String(v).trim();
}

function _dewImportLevelsFile() {
  var fileInp = document.getElementById('dew-lv-import-file');
  var file = fileInp && fileInp.files[0];
  var status = document.getElementById('dew-lv-import-status');
  if (!file) { if (status) status.innerHTML = '<span style="color:var(--warn)">Выберите файл</span>'; return; }
  if (typeof XLSX === 'undefined') { if (status) status.innerHTML = '<span style="color:var(--bad)">Библиотека SheetJS не загружена</span>'; return; }

  if (status) status.innerHTML = '<span style="color:var(--txt-3)">Обработка файла…</span>';

  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      // cellDates:true + raw:true — дата, которую Excel хранит как число со
      // стилем формата (а не как текст), придёт уже как объект Date, а не
      // как "7/31/26" в стиле ячейки (dateNF в sheet_to_json тут не помогает:
      // он уступает собственному числовому формату ячейки). Заодно raw:true
      // отдаёт значения зумпфов настоящими числами, а не форматированной строкой.
      var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
      if (rows.length < 4) { status.innerHTML = '<span style="color:var(--bad)">Файл пустой или не похож на шаблон</span>'; return; }

      // Строка 2 (индекс 2) — заголовки-ключи, строка 3 (индекс 3) обычно
      // пример (#ПРИМЕР), но если пользователь начал вводить данные прямо в
      // неё (не добавляя строку ниже) — это тоже настоящая строка данных,
      // отбрасываем по маркеру "#", а не по фиксированному номеру строки.
      var headers = rows[2].map(function(h) { return String(h).trim(); });
      var dataRows = rows.slice(3).filter(function(r) {
        return r[0] && String(r[0]).trim() && String(r[0]).trim().charAt(0) !== '#';
      });

      // Сопоставляем колонки с 4-й (индекс 3) с зумпфами по точному названию
      var sumpCols = [];
      var unknownCols = [];
      for (var ci = 3; ci < headers.length; ci++) {
        var name = headers[ci];
        if (!name) continue;
        var sump = DewateringState.sumps.find(function(s) { return s.name === name; });
        if (sump) sumpCols.push({ col: ci, sumpId: sump.id });
        else unknownCols.push(name);
      }
      if (!sumpCols.length) {
        status.innerHTML = '<span style="color:var(--bad)">Не найдено ни одной знакомой колонки-зумпфа. Скачайте актуальный шаблон заново.</span>';
        return;
      }

      var created = 0, updated = 0, errors = 0;
      dataRows.forEach(function(row) {
        var isoDate = _dewParseImportDate(row[0]);
        if (!isoDate) { errors++; return; }
        var time       = _dewParseImportTime(row[1]);
        var measuredBy = row[2] == null ? '' : String(row[2]).trim();

        sumpCols.forEach(function(sc) {
          var raw = row[sc.col];
          if (raw === undefined || raw === null || raw === '') return; // пустая ячейка — не трогаем существующие данные

          var val = (typeof raw === 'number') ? raw : parseFloat(String(raw).trim().replace(',', '.'));
          if (isNaN(val)) { errors++; return; }

          var existing = DewateringState.waterLevelFor(sc.sumpId, isoDate);
          if (existing) {
            var patch = { elevation: val };
            if (time)       patch.time       = time;
            if (measuredBy) patch.measuredBy = measuredBy;
            DewateringState.updateWaterLevel(existing.id, patch);
            updated++;
          } else {
            DewateringState.addWaterLevel({
              sumpId: sc.sumpId, date: isoDate, time: time || '06:00',
              elevation: val, measuredBy: measuredBy, notes: '',
            });
            created++;
          }
        });
      });

      if (unknownCols.length) console.warn('[dewatering] импорт уровней: колонки не распознаны как зумпфы —', unknownCols.join(', '));

      _dewCloseLevelsImportModal();
      _dewRenderLevels();
      var msg = 'Загрузка завершена: создано ' + created + ', обновлено ' + updated;
      if (errors) msg += ', ошибок ' + errors;
      if (unknownCols.length) msg += ', не распознано колонок: ' + unknownCols.length;
      Toast.show(msg, errors || unknownCols.length ? 'warning' : 'success');
    } catch (ex) {
      console.error('[dewatering] ошибка импорта уровней воды', ex);
      if (status) status.innerHTML = '<span style="color:var(--bad)">Ошибка чтения файла: ' + escHTML(ex.message) + '</span>';
    }
  };
  reader.readAsArrayBuffer(file);
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

  var btnStyle = function(active) {
    return 'padding:4px 10px;border-radius:5px;border:1px solid var(--line);font-size:11px;font-weight:600;cursor:pointer;transition:.15s;' +
      (active ? 'background:var(--accent,#3b82f6);color:#fff;border-color:var(--accent,#3b82f6)' : 'background:var(--bg-3,var(--bg-2));color:var(--txt-2)');
  };
  var presets = [['7', '7д'], ['30', '30д'], ['90', '90д'], ['0', 'Всё']];
  var presetBtns = presets.map(function(p) {
    var active = !_dewAFilter.dateFrom && !_dewAFilter.dateTo && String(_dewAFilter.days) === p[0];
    return '<button id="dew-af-p' + p[0] + '" style="' + btnStyle(active) + '">' + p[1] + '</button>';
  }).join('');

  el.innerHTML =
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;padding:10px 12px;background:var(--bg-2);border-radius:var(--r);border:1px solid var(--line)">' +
      '<span style="font-size:11px;color:var(--txt-3);white-space:nowrap">Фильтр:</span>' +
      '<select id="dew-af-quarry" class="form-control" style="width:130px;font-size:12px">' + _dewQuarryOpts(_dewAFilter.quarry) + '</select>' +
      '<select id="dew-af-sump" class="form-control" style="width:160px;font-size:12px">' + anlSumpOpts(_dewAFilter.quarry) + '</select>' +
      '<span style="width:1px;height:20px;background:var(--line);margin:0 2px"></span>' +
      presetBtns +
      '<span style="font-size:11px;color:var(--txt-3)">или</span>' +
      '<input type="date" id="dew-af-from" class="form-control" style="width:130px;font-size:12px" value="' + (_dewAFilter.dateFrom || '') + '" title="Начало периода">' +
      '<span style="font-size:11px;color:var(--txt-3)">—</span>' +
      '<input type="date" id="dew-af-to" class="form-control" style="width:130px;font-size:12px" value="' + (_dewAFilter.dateTo || '') + '" title="Конец периода">' +
      '<button id="dew-af-settings" title="Настройка аналитики" style="margin-left:auto;padding:4px 10px;border-radius:5px;border:1px solid var(--line);font-size:12px;cursor:pointer;background:' + (_dewAnlSettings.includedSumpIds || _dewAnlSettings.includedPumpIds ? 'var(--accent,#3b82f6)' : 'var(--bg-3,var(--bg-2))') + ';color:' + (_dewAnlSettings.includedSumpIds || _dewAnlSettings.includedPumpIds ? '#fff' : 'var(--txt-2)') + '">⚙ Настройка</button>' +
    '</div>' +
    '<div id="dew-anl-kpis" style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px"></div>' +
    '<div class="card" style="padding:14px;margin-bottom:14px">' +
      '<div class="card-title" id="dew-anl-trend-title">Объём откачки по насосам</div>' +
      '<div style="position:relative;height:200px"><canvas id="dew-canvas-anltrend" style="position:absolute;inset:0;width:100%;height:100%"></canvas></div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">' +
      '<div class="card" style="padding:14px">' +
        '<div class="card-title">Статус насосов</div>' +
        '<div id="dew-anl-pumpcards" style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto"></div>' +
      '</div>' +
      '<div class="card" style="padding:14px">' +
        '<div class="card-title">Направления откачки</div>' +
        '<div id="dew-anl-dest-wrap" style="position:relative;height:260px"><canvas id="dew-canvas-anldest" style="position:absolute;inset:0;width:100%;height:100%"></canvas></div>' +
      '</div>' +
      '<div class="card" style="padding:14px">' +
        '<div class="card-title" id="dew-anl-heat-title">Часы работы</div>' +
        '<div id="dew-anl-heatmap" style="overflow-x:auto"></div>' +
      '</div>' +
    '</div>';

  document.getElementById('dew-af-quarry').addEventListener('change', function() {
    _dewAFilter.quarry = this.value;
    _dewAFilter.sumpId = '';
    var sf = document.getElementById('dew-af-sump');
    if (sf) sf.innerHTML = anlSumpOpts(this.value);
    _dewAnlRefreshAll();
  });
  document.getElementById('dew-af-sump').addEventListener('change', function() {
    _dewAFilter.sumpId = this.value;
    _dewAnlRefreshAll();
  });

  // Period preset buttons
  presets.forEach(function(p) {
    var btn = document.getElementById('dew-af-p' + p[0]);
    if (!btn) return;
    btn.addEventListener('click', function() {
      _dewAFilter.days = parseInt(p[0]);
      _dewAFilter.dateFrom = '';
      _dewAFilter.dateTo = '';
      var fi = document.getElementById('dew-af-from');
      var ti = document.getElementById('dew-af-to');
      if (fi) fi.value = '';
      if (ti) ti.value = '';
      _dewAnlUpdatePresetBtns();
      _dewAnlRefreshAll();
    });
  });

  // Custom date range
  function onDateChange() {
    var f = document.getElementById('dew-af-from');
    var t = document.getElementById('dew-af-to');
    var fv = f ? f.value : '';
    var tv = t ? t.value : '';
    if (fv || tv) {
      _dewAFilter.dateFrom = fv;
      _dewAFilter.dateTo = tv;
      _dewAFilter.days = 30; // reset preset highlight
      _dewAnlUpdatePresetBtns();
      _dewAnlRefreshAll();
    }
  }
  var fi = document.getElementById('dew-af-from');
  var ti = document.getElementById('dew-af-to');
  if (fi) fi.addEventListener('change', onDateChange);
  if (ti) ti.addEventListener('change', onDateChange);

  var settBtn = document.getElementById('dew-af-settings');
  if (settBtn) settBtn.addEventListener('click', _dewAnlOpenSettings);

  _dewAnlRefreshAll();
}

function _dewAnlRefreshAll() {
  _dewAnlKpis();
  _dewAnlTrend();
  _dewAnlPumpCards();
  _dewAnlDest();
  _dewAnlHeatmap();
}

// Возвращает объём записи, идущий ТОЛЬКО в финальные направления (не intermediate_sump).
// Это исключает двойной счёт у насосов-перекаччиков.
function _dewAnlFinalVolume(rec) {
  var total = DewateringState.computedVolume(rec);
  if (!total) return 0;
  var dists = DewateringState.getDistributions(rec);
  if (!dists || !dists.length) return total;
  var finalPct = 0;
  dists.forEach(function(d) {
    var dest = d.destinationId ? DewateringState.destById(d.destinationId) : null;
    if (!dest || dest.type !== 'intermediate_sump') finalPct += (d.pct || 0);
  });
  return finalPct >= 100 ? total : total * finalPct / 100;
}

// Суммарный финальный объём зумпфа за период (массив дат)
function _dewAnlSumpVol(sumpId, days) {
  var pIds = DewateringState.pumpsOfSump(sumpId).map(function(p) { return p.id; });
  var daySet = {};
  days.forEach(function(d) { daySet[d] = true; });
  return DewateringState.meterReadings
    .filter(function(r) { return pIds.indexOf(r.pumpId) >= 0 && daySet[r.date]; })
    .reduce(function(acc, r) { return acc + _dewAnlFinalVolume(r); }, 0);
}

function _dewAnlUpdatePresetBtns() {
  var presets = [['7','7д'],['30','30д'],['90','90д'],['0','Всё']];
  var hasCustom = !!(_dewAFilter.dateFrom || _dewAFilter.dateTo);
  presets.forEach(function(p) {
    var btn = document.getElementById('dew-af-p' + p[0]);
    if (!btn) return;
    var active = !hasCustom && String(_dewAFilter.days) === p[0];
    btn.style.cssText = 'padding:4px 10px;border-radius:5px;border:1px solid var(--line);font-size:11px;font-weight:600;cursor:pointer;transition:.15s;' +
      (active ? 'background:var(--accent,#3b82f6);color:#fff;border-color:var(--accent,#3b82f6)' : 'background:var(--bg-3,var(--bg-2));color:var(--txt-2)');
  });
}

// Открывает модальную панель настройки аналитики (выбор зумпфов и насосов)
function _dewAnlOpenSettings() {
  var existing = document.getElementById('dew-anl-settings-modal');
  if (existing) { existing.remove(); return; }

  var overlay = document.createElement('div');
  overlay.id = 'dew-anl-settings-modal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;align-items:flex-start;justify-content:flex-end;padding:60px 24px 0 0';

  var panel = document.createElement('div');
  panel.style.cssText = 'background:var(--bg-1,#111827);border:1px solid var(--line);border-radius:10px;width:320px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.5);display:flex;flex-direction:column';

  var inclSumps = _dewAnlSettings.includedSumpIds ? _dewAnlSettings.includedSumpIds.slice() : null;
  var inclPumps = _dewAnlSettings.includedPumpIds ? _dewAnlSettings.includedPumpIds.slice() : null;

  function allSumpIds() { return DewateringState.sumps.map(function(s) { return s.id; }); }
  function allPumpIds() { return DewateringState.pumps.map(function(p) { return p.id; }); }
  function isSumpOn(id) { return !inclSumps || inclSumps.indexOf(id) >= 0; }
  function isPumpOn(id) { return !inclPumps || inclPumps.indexOf(id) >= 0; }

  function buildHTML() {
    var html = '<div style="padding:14px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between">' +
      '<span style="font-size:13px;font-weight:700;color:var(--txt-1)">Настройка аналитики</span>' +
      '<button id="dew-anl-sett-close" style="background:none;border:none;color:var(--txt-3);font-size:18px;cursor:pointer;line-height:1">✕</button>' +
    '</div>' +
    '<div style="padding:10px 14px;border-bottom:1px solid var(--line);display:flex;gap:8px">' +
      '<button id="dew-anl-sett-all" style="flex:1;padding:5px 8px;border-radius:5px;border:1px solid var(--line);font-size:11px;cursor:pointer;background:var(--bg-2);color:var(--txt-2)">Выбрать всё</button>' +
      '<button id="dew-anl-sett-none" style="flex:1;padding:5px 8px;border-radius:5px;border:1px solid var(--line);font-size:11px;cursor:pointer;background:var(--bg-2);color:var(--txt-2)">Сбросить</button>' +
    '</div>';

    DewateringState.sumps.forEach(function(sump) {
      var sOn = isSumpOn(sump.id);
      var pumps = DewateringState.pumpsOfSump(sump.id);
      html += '<div style="border-bottom:1px solid var(--line)">' +
        '<label style="display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;background:var(--bg-2)">' +
          '<input type="checkbox" data-sump="' + sump.id + '" ' + (sOn ? 'checked' : '') + ' style="accent-color:var(--accent,#3b82f6)">' +
          '<span style="font-size:12px;font-weight:600;color:var(--txt-1)">' + escHTML(sump.name) + '</span>' +
          (sump.quarry ? '<span style="font-size:10px;color:var(--txt-3);margin-left:auto">' + escHTML(sump.quarry) + '</span>' : '') +
        '</label>';
      pumps.forEach(function(p) {
        var pOn = isPumpOn(p.id);
        var sc = { working:'#10b981', standby:'#3b82f6', repair:'#f59e0b', off:'#64748b' }[p.status] || '#64748b';
        html += '<label style="display:flex;align-items:center;gap:8px;padding:6px 14px 6px 32px;cursor:pointer">' +
          '<input type="checkbox" data-pump="' + p.id + '" data-sump="' + sump.id + '" ' + (pOn ? 'checked' : '') + ' style="accent-color:var(--accent,#3b82f6)">' +
          '<span style="width:6px;height:6px;border-radius:50%;background:' + sc + ';flex-shrink:0"></span>' +
          '<span style="font-size:11px;color:var(--txt-2)">' + escHTML(p.name) + (p.model ? ' <span style="color:var(--txt-3)">· ' + escHTML(p.model) + '</span>' : '') + '</span>' +
        '</label>';
      });
      html += '</div>';
    });

    html += '<div style="padding:12px 14px;display:flex;gap:8px">' +
      '<button id="dew-anl-sett-apply" style="flex:1;padding:7px 12px;border-radius:6px;border:none;background:var(--accent,#3b82f6);color:#fff;font-size:12px;font-weight:600;cursor:pointer">Применить</button>' +
      '<button id="dew-anl-sett-reset" style="padding:7px 12px;border-radius:6px;border:1px solid var(--line);background:var(--bg-2);color:var(--txt-2);font-size:12px;cursor:pointer">Сбросить всё</button>' +
    '</div>';
    return html;
  }

  panel.innerHTML = buildHTML();

  // Events
  panel.addEventListener('change', function(e) {
    var t = e.target;
    if (t.dataset.sump && !t.dataset.pump) {
      // Sump checkbox → toggle sump + all its pumps
      var sid = t.dataset.sump;
      var pumpIds = DewateringState.pumpsOfSump(sid).map(function(p) { return p.id; });
      if (t.checked) {
        if (inclSumps) { if (inclSumps.indexOf(sid) < 0) inclSumps.push(sid); }
        if (inclPumps) pumpIds.forEach(function(pid) { if (inclPumps.indexOf(pid) < 0) inclPumps.push(pid); });
      } else {
        if (!inclSumps) inclSumps = allSumpIds().filter(function(id) { return id !== sid; });
        else inclSumps = inclSumps.filter(function(id) { return id !== sid; });
        if (!inclPumps) inclPumps = allPumpIds().filter(function(id) { return pumpIds.indexOf(id) < 0; });
        else inclPumps = inclPumps.filter(function(id) { return pumpIds.indexOf(id) < 0; });
      }
      // Sync pump checkboxes
      pumpIds.forEach(function(pid) {
        var cb = panel.querySelector('input[data-pump="' + pid + '"]');
        if (cb) cb.checked = t.checked;
      });
    } else if (t.dataset.pump) {
      var pid = t.dataset.pump;
      if (t.checked) {
        if (inclPumps) { if (inclPumps.indexOf(pid) < 0) inclPumps.push(pid); }
      } else {
        if (!inclPumps) inclPumps = allPumpIds().filter(function(id) { return id !== pid; });
        else inclPumps = inclPumps.filter(function(id) { return id !== pid; });
      }
    }
  });

  panel.addEventListener('click', function(e) {
    var id = e.target.id || (e.target.closest && e.target.closest('button') && e.target.closest('button').id);
    if (!id && e.target.closest) id = (e.target.closest('button') || {}).id;
    if (id === 'dew-anl-sett-close') { overlay.remove(); return; }
    if (id === 'dew-anl-sett-all') {
      inclSumps = null; inclPumps = null;
      panel.querySelectorAll('input[type=checkbox]').forEach(function(cb) { cb.checked = true; });
      return;
    }
    if (id === 'dew-anl-sett-none') {
      inclSumps = []; inclPumps = [];
      panel.querySelectorAll('input[type=checkbox]').forEach(function(cb) { cb.checked = false; });
      return;
    }
    if (id === 'dew-anl-sett-reset') {
      _dewAnlSettings.includedSumpIds = null;
      _dewAnlSettings.includedPumpIds = null;
      localStorage.setItem('dew_anl_settings', JSON.stringify(_dewAnlSettings));
      overlay.remove();
      _dewRenderAnalytics();
      return;
    }
    if (id === 'dew-anl-sett-apply') {
      _dewAnlSettings.includedSumpIds = inclSumps;
      _dewAnlSettings.includedPumpIds = inclPumps;
      localStorage.setItem('dew_anl_settings', JSON.stringify(_dewAnlSettings));
      overlay.remove();
      _dewRenderAnalytics();
      return;
    }
  });

  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

// Возвращает pump IDs с учётом фильтра И настроек аналитики
function _dewAnlEffectivePumpIds() {
  var fromFilter = _dewAFilteredPumpIds(); // null = all
  var fromSettings = _dewAnlSettings.includedPumpIds; // null = all
  if (!fromFilter && !fromSettings) return null;
  var base = fromFilter || DewateringState.pumps.map(function(p) { return p.id; });
  if (fromSettings) base = base.filter(function(id) { return fromSettings.indexOf(id) >= 0; });
  return base;
}

// Returns sorted array of ISO date strings for the current filter period
function _dewAnlDays() {
  if (_dewAFilter.dateFrom || _dewAFilter.dateTo) {
    var from = _dewAFilter.dateFrom
      ? new Date(_dewAFilter.dateFrom + 'T00:00:00')
      : (function() { var d = new Date(); d.setFullYear(d.getFullYear() - 1); return d; })();
    var to = _dewAFilter.dateTo
      ? new Date(_dewAFilter.dateTo + 'T00:00:00')
      : new Date();
    var days = [];
    var cur = new Date(from);
    while (cur <= to) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }
  var N = _dewAFilter.days || 0;
  if (N === 0) {
    // All time: find min/max dates in readings
    var dates = DewateringState.meterReadings.map(function(r) { return r.date; }).filter(Boolean).sort();
    if (!dates.length) { N = 30; }
    else {
      var minD = new Date(dates[0] + 'T00:00:00');
      var maxD = new Date(dates[dates.length - 1] + 'T00:00:00');
      var days = [];
      var cur = new Date(minD);
      while (cur <= maxD) {
        days.push(cur.toISOString().slice(0, 10));
        cur.setDate(cur.getDate() + 1);
      }
      return days;
    }
  }
  var days = [];
  for (var i = N - 1; i >= 0; i--) {
    var d = new Date(); d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function _dewAnlPeriodLabel() {
  var days = _dewAnlDays();
  if (!days.length) return '';
  if (_dewAFilter.dateFrom || _dewAFilter.dateTo) {
    return days[0] + ' — ' + days[days.length - 1];
  }
  if (_dewAFilter.days === 0) return 'Всё время (' + days.length + ' дн.)';
  return '· ' + days.length + ' дней';
}

function _dewSparkSvg(values, color) {
  var n = values.length;
  if (n < 2) return '';
  var max = 0;
  for (var i = 0; i < n; i++) if (values[i] > max) max = values[i];
  if (!max) return '';
  var W = 80, H = 28, pad = 2;
  var pts = values.map(function(v, i) {
    var x = pad + i / (n - 1) * (W - pad * 2);
    var y = H - pad - (v / max) * (H - pad * 2);
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="display:block">' +
    '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' +
    '</svg>';
}

function _dewAnlKpis() {
  var wrap = document.getElementById('dew-anl-kpis');
  if (!wrap) return;

  // Update trend chart title
  var titleEl = document.getElementById('dew-anl-trend-title');
  if (titleEl) titleEl.textContent = 'Объём откачки по зумпфам ' + _dewAnlPeriodLabel();

  var pids = _dewAnlEffectivePumpIds();
  var days = _dewAnlDays();
  var N = days.length || 1;
  var daySet = {};
  days.forEach(function(d) { daySet[d] = true; });

  // Фильтруем только финальный объём (исключаем перекачку между зумпфами)
  var dailyVols = days.map(function(day) {
    return DewateringState.meterReadings
      .filter(function(r) { return r.date === day && (!pids || pids.indexOf(r.pumpId) >= 0); })
      .reduce(function(a, r) { return a + _dewAnlFinalVolume(r); }, 0);
  });

  var vol30 = dailyVols.reduce(function(a, v) { return a + v; }, 0);
  var daysWithData = dailyVols.filter(function(v) { return v > 0; }).length || 1;
  var avgDaily = vol30 / daysWithData;

  var allPumps = pids
    ? DewateringState.pumps.filter(function(p) { return pids.indexOf(p.id) >= 0; })
    : DewateringState.pumps;
  var activePumps = allPumps.filter(function(p) { return p.status === 'working'; }).length;

  var totalHours = 0;
  DewateringState.meterReadings.forEach(function(r) {
    if (days.indexOf(r.date) < 0) return;
    if (pids && pids.indexOf(r.pumpId) < 0) return;
    totalHours += (r.hoursWorked || 0);
  });
  var maxHours = allPumps.length * N * 24;
  var kio = maxHours > 0 ? Math.round(totalHours / maxHours * 100) : 0;

  var downtimePumpDays = {};
  DewateringState.meterReadings.forEach(function(r) {
    if (days.indexOf(r.date) < 0) return;
    if (pids && pids.indexOf(r.pumpId) < 0) return;
    if (r.isStopped) downtimePumpDays[r.date + '_' + r.pumpId] = true;
  });
  var downtimeCount = Object.keys(downtimePumpDays).length;

  // Previous period of same length for delta comparison
  var prevVol = 0;
  if (!_dewAFilter.dateFrom && !_dewAFilter.dateTo && N > 0 && N < 3000) {
    var prevDays = [];
    for (var j = N * 2 - 1; j >= N; j--) {
      var pd = new Date(); pd.setDate(pd.getDate() - j);
      prevDays.push(pd.toISOString().slice(0, 10));
    }
    prevVol = prevDays.reduce(function(acc, day) {
      return acc + DewateringState.meterReadings
        .filter(function(r) { return r.date === day && (!pids || pids.indexOf(r.pumpId) >= 0); })
        .reduce(function(a, r) { return a + _dewAnlFinalVolume(r); }, 0);
    }, 0);
  }
  var volDelta = prevVol > 0 ? Math.round((vol30 - prevVol) / prevVol * 100) : null;
  var sparkN = Math.min(14, dailyVols.length);
  var sparkVals = dailyVols.slice(-sparkN);

  var periodLabel = _dewAnlPeriodLabel();

  function kpiTile(label, value, sub, color, sparkVals, deltaVal) {
    var sparkHtml = sparkVals ? _dewSparkSvg(sparkVals, color) : '';
    var deltaHtml = '';
    if (deltaVal !== null && deltaVal !== undefined) {
      var sign = deltaVal >= 0 ? '+' : '';
      var bg = deltaVal >= 0 ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.13)';
      var fg = deltaVal >= 0 ? '#34d399' : '#f87171';
      deltaHtml = '<div style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:600;padding:2px 6px;border-radius:12px;margin-top:5px;background:' + bg + ';color:' + fg + '">' + sign + deltaVal + '% пред. период</div>';
    }
    return '<div style="background:var(--bg-2);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px;border-top:3px solid ' + color + '">' +
      '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--txt-3);margin-bottom:6px">' + label + '</div>' +
      '<div style="font-size:22px;font-weight:800;color:var(--txt-1);font-variant-numeric:tabular-nums;line-height:1.15">' + value + '</div>' +
      (sub ? '<div style="font-size:10px;color:var(--txt-3);margin-top:3px">' + sub + '</div>' : '') +
      (sparkHtml ? '<div style="margin-top:8px">' + sparkHtml + '</div>' : '') +
      deltaHtml +
    '</div>';
  }

  wrap.innerHTML =
    kpiTile('Объём ' + periodLabel, (vol30 >= 1000 ? (vol30/1000).toFixed(1)+' тыс.' : vol30.toFixed(0)) + ' м³', 'суммарно', '#3b82f6', sparkVals, volDelta) +
    kpiTile('Среднесуточно', avgDaily.toFixed(0) + ' м³/сут', 'дней с данными: ' + daysWithData, '#06b6d4', null, null) +
    kpiTile('Активных насосов', activePumps + ' / ' + allPumps.length, 'статус «работает»', '#10b981', null, null) +
    kpiTile('КИО', kio + '%', 'коэф. использования', kio >= 70 ? '#10b981' : kio >= 40 ? '#f59e0b' : '#ef4444', null, null) +
    kpiTile('Простоев', downtimeCount + '', 'насос-дней за период', downtimeCount === 0 ? '#10b981' : downtimeCount <= 5 ? '#f59e0b' : '#ef4444', null, null);
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

function _dewAnlTrend() {
  _dewDestroyChart('anltrend');
  var canvas = document.getElementById('dew-canvas-anltrend');
  if (!canvas) return;

  var pids = _dewAnlEffectivePumpIds();
  var days = _dewAnlDays();
  var daySet = {};
  days.forEach(function(d) { daySet[d] = true; });

  // Группируем по зумпфам (финальный объём — без перекачки между зумпфами)
  var filteredSumps = DewateringState.sumps.filter(function(s) {
    if (_dewAFilter.sumpId && s.id !== _dewAFilter.sumpId) return false;
    if (_dewAFilter.quarry && (s.quarry || '') !== _dewAFilter.quarry) return false;
    if (_dewAnlSettings.includedSumpIds && _dewAnlSettings.includedSumpIds.indexOf(s.id) < 0) return false;
    return true;
  });

  var sumpVols = filteredSumps.map(function(s) {
    var pumpIds = DewateringState.pumpsOfSump(s.id).map(function(p) { return p.id; });
    if (pids) pumpIds = pumpIds.filter(function(id) { return pids.indexOf(id) >= 0; });
    var vol = DewateringState.meterReadings
      .filter(function(r) { return pumpIds.indexOf(r.pumpId) >= 0 && daySet[r.date]; })
      .reduce(function(acc, r) { return acc + _dewAnlFinalVolume(r); }, 0);
    return { sump: s, pumpIds: pumpIds, vol: vol };
  }).sort(function(a, b) { return b.vol - a.vol; });

  var SUMP_COLORS = [
    'rgba(59,130,246,0.75)', 'rgba(16,185,129,0.75)', 'rgba(245,158,11,0.75)',
    'rgba(239,68,68,0.75)', 'rgba(139,92,246,0.75)', 'rgba(6,182,212,0.75)'
  ];

  var datasets = sumpVols.map(function(sv, si) {
    var pumpIds = sv.pumpIds;
    var data = days.map(function(day) {
      return DewateringState.meterReadings
        .filter(function(r) { return pumpIds.indexOf(r.pumpId) >= 0 && r.date === day; })
        .reduce(function(a, r) { return a + _dewAnlFinalVolume(r); }, 0);
    });
    var col = SUMP_COLORS[si % SUMP_COLORS.length];
    return {
      type: 'bar', label: sv.sump.name, data: data,
      backgroundColor: col, borderColor: col.replace('0.75', '1'),
      borderWidth: 1, borderRadius: 2, stack: 'vol'
    };
  });

  // MA7 overlay
  var totalPerDay = days.map(function(_, di) {
    return datasets.reduce(function(acc, ds) { return acc + (ds.data ? ds.data[di] : 0); }, 0);
  });
  var ma7 = totalPerDay.map(function(_, i) {
    var start = Math.max(0, i - 6);
    var slice = totalPerDay.slice(start, i + 1);
    return slice.reduce(function(a, v) { return a + v; }, 0) / slice.length;
  });
  datasets.push({
    type: 'line', label: 'MA7', data: ma7,
    borderColor: 'rgba(251,191,36,0.9)', backgroundColor: 'transparent',
    borderWidth: 2, pointRadius: 0, pointHoverRadius: 4,
    tension: 0.35, order: -1
  });

  var labels = days.map(function(d) {
    var dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  });

  _dewCharts['anltrend'] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: labels, datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { size: 11 }, boxWidth: 12, color: '#b0b8c8', padding: 8 } },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: {
            title: function(items) { return days[items[0].dataIndex]; },
            label: function(item) {
              if (!item.raw) return null;
              var v = item.dataset.label === 'MA7' ? item.raw.toFixed(0) : item.raw.toLocaleString('ru-RU');
              return ' ' + item.dataset.label + ': ' + v + ' м³';
            }
          }
        }
      },
      scales: {
        x: { stacked: true, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { font: { size: 11 }, maxTicksLimit: 10, maxRotation: 45 } },
        y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { font: { size: 11 }, callback: function(v) { return v >= 1000 ? (v/1000).toFixed(0)+'k' : v; } } }
      }
    }
  });
}

function _dewAnlPumpCards() {
  var wrap = document.getElementById('dew-anl-pumpcards');
  if (!wrap) return;

  var pids = _dewAnlEffectivePumpIds();
  var pumps = (pids
    ? DewateringState.pumps.filter(function(p) { return pids.indexOf(p.id) >= 0; })
    : DewateringState.pumps
  ).slice().sort(function(a, b) {
    var o = { working: 0, standby: 1, repair: 2, off: 3 };
    return (o[a.status] || 3) - (o[b.status] || 3);
  });

  if (!pumps.length) { wrap.innerHTML = '<p class="dew-no-data">Нет насосов</p>'; return; }

  var days = _dewAnlDays();
  var daySet = {};
  days.forEach(function(d) { daySet[d] = true; });
  // Спарклайн: последние 14 дней периода (или меньше)
  var sparkDays = days.slice(-14);

  var SC = { working: '#10b981', standby: '#3b82f6', repair: '#f59e0b', off: '#64748b' };
  var SL = { working: 'Работает', standby: 'Резерв', repair: 'Ремонт', off: 'Выкл' };

  wrap.innerHTML = pumps.map(function(p) {
    var sc = SC[p.status] || '#64748b';
    var sl = SL[p.status] || p.status || '—';
    // Объём за выбранный период
    var volTotal = DewateringState.meterReadings
      .filter(function(r) { return r.pumpId === p.id && daySet[r.date]; })
      .reduce(function(acc, r) { return acc + _dewAnlFinalVolume(r); }, 0);
    var sump = DewateringState.sumps.find(function(s) { return s.id === p.sumpId; });
    var sumpName = sump ? sump.name : '—';
    var sparkVals = sparkDays.map(function(day) {
      return DewateringState.meterReadings
        .filter(function(r) { return r.date === day && r.pumpId === p.id; })
        .reduce(function(a, r) { return a + _dewAnlFinalVolume(r); }, 0);
    });
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg-3,var(--bg-2));border-radius:6px;border-left:3px solid ' + sc + '">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:12px;font-weight:600;color:var(--txt-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHTML(p.name) + '</div>' +
        '<div style="font-size:10px;color:var(--txt-3);margin-top:1px">' + escHTML(sumpName) + (p.model ? ' · ' + escHTML(p.model) : '') + '</div>' +
        '<div style="font-size:10px;color:var(--txt-2);margin-top:2px;font-variant-numeric:tabular-nums">' + volTotal.toLocaleString('ru-RU') + ' м³ за период</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">' +
        '<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:' + sc + '22;color:' + sc + '">' + sl + '</span>' +
        _dewSparkSvg(sparkVals, sc) +
      '</div>' +
    '</div>';
  }).join('');
}

function _dewAnlDest() {
  _dewDestroyChart('anldest');
  var canvas = document.getElementById('dew-canvas-anldest');
  if (!canvas) return;

  var pids = _dewAnlEffectivePumpIds();
  var days = _dewAnlDays();
  var daySet = {};
  days.forEach(function(d) { daySet[d] = true; });
  var byDest = {};
  DewateringState.meterReadings.forEach(function(r) {
    if (pids && pids.indexOf(r.pumpId) < 0) return;
    if (!daySet[r.date]) return;
    var vol = DewateringState.computedVolume(r) || 0;
    if (!vol) return;
    DewateringState.getDistributions(r).forEach(function(d) {
      if (!d.destinationId) return;
      var dest = DewateringState.destById(d.destinationId);
      if (dest && dest.type === 'intermediate_sump') return; // не показываем перекачку
      byDest[d.destinationId] = (byDest[d.destinationId] || 0) + vol * d.pct / 100;
    });
  });

  var total = Object.keys(byDest).reduce(function(a, k) { return a + byDest[k]; }, 0);
  if (!total) { canvas.parentElement.innerHTML = '<p class="dew-no-data">Нет данных</p>'; return; }

  // Собираем детализацию: для каждого направления — объём по насосам
  var byDestPump = {}; // destId → { pumpId → vol }
  DewateringState.meterReadings.forEach(function(r) {
    if (pids && pids.indexOf(r.pumpId) < 0) return;
    if (!daySet[r.date]) return;
    var vol = DewateringState.computedVolume(r) || 0;
    if (!vol) return;
    DewateringState.getDistributions(r).forEach(function(d) {
      if (!d.destinationId) return;
      var dest = DewateringState.destById(d.destinationId);
      if (dest && dest.type === 'intermediate_sump') return;
      if (!byDestPump[d.destinationId]) byDestPump[d.destinationId] = {};
      byDestPump[d.destinationId][r.pumpId] = (byDestPump[d.destinationId][r.pumpId] || 0) + vol * d.pct / 100;
    });
  });

  var entries = Object.keys(byDest).map(function(k) {
    var d = DewateringState.destById(k);
    return { id: k, name: d ? d.name : 'Не указано', vol: byDest[k] };
  }).sort(function(a, b) { return b.vol - a.vol; });

  var COLORS = ['rgba(34,211,238,0.85)', 'rgba(52,211,153,0.85)', 'rgba(251,146,60,0.85)',
                'rgba(248,113,113,0.85)', 'rgba(188,140,255,0.85)', 'rgba(88,166,255,0.85)'];

  _dewCharts['anldest'] = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: entries.map(function(e) { return e.name; }),
      datasets: [{
        data: entries.map(function(e) { return e.vol; }),
        backgroundColor: entries.map(function(_, i) { return COLORS[i % COLORS.length]; }),
        borderColor: 'rgba(18,24,38,0.8)', borderWidth: 2, hoverOffset: 8
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      onClick: function(evt, elements) {
        if (!elements || !elements.length) return;
        var idx = elements[0].index;
        var entry = entries[idx];
        if (!entry) return;
        _dewAnlDestDrilldown(entry, byDestPump[entry.id] || {}, COLORS[idx % COLORS.length]);
      },
      plugins: {
        legend: {
          display: true, position: 'bottom',
          labels: { font: { size: 11 }, padding: 8, boxWidth: 10, color: '#b0b8c8',
            generateLabels: function(chart) {
              return chart.data.labels.map(function(lbl, i) {
                var v = chart.data.datasets[0].data[i];
                var pct = total > 0 ? Math.round(v / total * 100) : 0;
                return { text: lbl + ' (' + pct + '%)', fillStyle: COLORS[i % COLORS.length], strokeStyle: 'transparent', index: i };
              });
            }
          }
        },
        tooltip: { callbacks: { label: function(item) {
          var pct = total > 0 ? Math.round(item.raw / total * 100) : 0;
          return ' ' + item.raw.toLocaleString('ru-RU') + ' м³ (' + pct + '%) · нажмите для детализации';
        }}}
      }
    }
  });
}

// Всплывающая детализация по направлению: список насосов с объёмами
function _dewAnlDestDrilldown(entry, pumpVolMap, color) {
  var existing = document.getElementById('dew-anl-dest-drill');
  if (existing) existing.remove();

  var pumpRows = Object.keys(pumpVolMap).map(function(pid) {
    var pump = DewateringState.pumps.find(function(p) { return p.id === pid; });
    var sump = pump ? DewateringState.sumps.find(function(s) { return s.id === pump.sumpId; }) : null;
    return {
      name: pump ? (pump.name || '(без имени)') : '(насос удалён)',
      sumpName: sump ? sump.name : '—',
      vol: pumpVolMap[pid],
      deleted: !pump
    };
  }).filter(function(r) { return !r.deleted; }) // скрываем удалённые насосы
    .sort(function(a, b) { return b.vol - a.vol; });

  var total = pumpRows.reduce(function(acc, r) { return acc + r.vol; }, 0);
  var maxVol = pumpRows.length ? pumpRows[0].vol : 1;

  var modal = document.createElement('div');
  modal.id = 'dew-anl-dest-drill';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)';

  var box = document.createElement('div');
  box.style.cssText = 'background:var(--bg-1,#111827);border:1px solid var(--line);border-radius:10px;width:460px;max-height:80vh;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,.6)';

  var rows = pumpRows.map(function(r) {
    var pct = total > 0 ? Math.round(r.vol / total * 100) : 0;
    var barW = maxVol > 0 ? Math.round(r.vol / maxVol * 100) : 0;
    return '<div style="padding:8px 16px;border-bottom:1px solid var(--line)">' +
      '<div style="display:flex;justify-content:space-between;margin-bottom:4px">' +
        '<div>' +
          '<span style="font-size:12px;font-weight:600;color:var(--txt-1)">' + escHTML(r.name) + '</span>' +
          '<span style="font-size:10px;color:var(--txt-3);margin-left:8px">' + escHTML(r.sumpName) + '</span>' +
        '</div>' +
        '<div style="font-size:12px;font-variant-numeric:tabular-nums;color:var(--txt-1)">' +
          r.vol.toLocaleString('ru-RU') + ' м³ <span style="color:var(--txt-3);font-size:10px">(' + pct + '%)</span>' +
        '</div>' +
      '</div>' +
      '<div style="height:4px;background:rgba(255,255,255,0.07);border-radius:2px">' +
        '<div style="height:4px;width:' + barW + '%;background:' + color + ';border-radius:2px"></div>' +
      '</div>' +
    '</div>';
  }).join('');

  box.innerHTML =
    '<div style="padding:14px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px">' +
      '<span style="width:12px;height:12px;border-radius:50%;background:' + color + ';flex-shrink:0"></span>' +
      '<span style="font-size:13px;font-weight:700;color:var(--txt-1)">' + escHTML(entry.name) + '</span>' +
      '<span style="font-size:11px;color:var(--txt-3);margin-left:4px">' + entry.vol.toLocaleString('ru-RU') + ' м³ всего</span>' +
      '<button id="dew-drill-close" style="margin-left:auto;background:none;border:none;color:var(--txt-3);font-size:18px;cursor:pointer">✕</button>' +
    '</div>' +
    '<div style="padding:8px 0;border-bottom:1px solid var(--line)">' +
      '<div style="padding:4px 16px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--txt-3)">Насос · Зумпф</div>' +
    '</div>' +
    rows +
    '<div style="padding:10px 16px;font-size:11px;color:var(--txt-3);text-align:center">Показаны все насосы, качавшие в это направление</div>';

  modal.appendChild(box);
  document.body.appendChild(modal);

  modal.addEventListener('click', function(e) {
    if (e.target === modal || e.target.id === 'dew-drill-close') modal.remove();
  });
}

function _dewAnlHeatmap() {
  var wrap = document.getElementById('dew-anl-heatmap');
  if (!wrap) return;

  var pids = _dewAnlEffectivePumpIds();
  var pumps = (pids
    ? DewateringState.pumps.filter(function(p) { return pids.indexOf(p.id) >= 0; })
    : DewateringState.pumps
  ).filter(function(p) { return p.status !== 'off'; });

  if (!pumps.length) { wrap.innerHTML = '<p class="dew-no-data">Нет активных насосов</p>'; return; }

  var allDays = _dewAnlDays();
  // Heatmap shows at most 30 days; take the last N days of the selected period
  var days = allDays.length > 30 ? allDays.slice(-30) : allDays;
  var heatTitle = document.getElementById('dew-anl-heat-title');
  if (heatTitle) heatTitle.textContent = 'Часы работы · ' + days.length + ' дней';

  function heatColor(h) {
    if (h === null || h === undefined) return 'rgba(255,255,255,0.04)';
    if (h === 0)  return 'rgba(239,68,68,0.30)';
    if (h < 8)   return 'rgba(245,158,11,0.40)';
    if (h < 16)  return 'rgba(251,191,36,0.50)';
    if (h < 22)  return 'rgba(16,185,129,0.55)';
    return 'rgba(52,211,153,0.75)';
  }

  var dayLabels = days.map(function(d) {
    var dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  });

  var html = '<table style="border-collapse:separate;border-spacing:2px;width:100%;font-size:10px">' +
    '<tr><th style="text-align:left;padding:2px 4px;color:var(--txt-3);font-weight:400"></th>' +
    dayLabels.map(function(l) {
      return '<th style="padding:0 2px;color:var(--txt-3);font-weight:400;text-align:center;font-size:9px;white-space:nowrap">' + l + '</th>';
    }).join('') + '</tr>';

  pumps.forEach(function(p) {
    html += '<tr><td style="padding:2px 4px;color:var(--txt-2);white-space:nowrap;font-weight:500;font-size:10px;max-width:70px;overflow:hidden;text-overflow:ellipsis" title="' + escHTML(p.name) + '">' + escHTML(p.name) + '</td>';
    days.forEach(function(day) {
      var rec = DewateringState.meterReadings.find(function(r) { return r.pumpId === p.id && r.date === day; });
      var h = rec
        ? (rec.isStopped ? 0 : (rec.hoursWorked !== undefined && rec.hoursWorked !== null ? rec.hoursWorked : null))
        : null;
      var bg = heatColor(h);
      var title = h !== null ? h + ' ч' : 'нет данных';
      html += '<td style="width:20px;height:20px;background:' + bg + ';border-radius:3px;text-align:center;cursor:default" title="' + escHTML(p.name) + ' · ' + day + ' · ' + title + '"></td>';
    });
    html += '</tr>';
  });

  html += '</table><div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap">' +
    [['rgba(255,255,255,0.04)','нет данных'],['rgba(239,68,68,0.30)','0 ч'],
     ['rgba(245,158,11,0.40)','< 8 ч'],['rgba(251,191,36,0.50)','8–16 ч'],
     ['rgba(16,185,129,0.55)','16–22 ч'],['rgba(52,211,153,0.75)','22–24 ч']].map(function(pair) {
      return '<span style="display:flex;align-items:center;gap:4px">' +
        '<span style="display:inline-block;width:10px;height:10px;background:' + pair[0] + ';border-radius:2px"></span>' +
        '<span style="color:var(--txt-3);font-size:10px">' + pair[1] + '</span></span>';
    }).join('') + '</div>';

  wrap.innerHTML = html;
}


// ── Excel Export ─────────────────────────────────────────────

function exportDewXLSX() {
  function doExport() {
    var XLSX = window.XLSX;
    if (!XLSX) { Toast.show('Библиотека Excel не загрузилась', 'error'); return; }

    var ts = new Date().toISOString().slice(0, 10);

    // ── Лист 1: Показания расходомеров ───────────────────────
    var rHdrs = ['Дата','Карьер','Зумпф','Насос','Статус',
      'Пред. показание, м³','Текущ. показание, м³','Объём за сутки, м³',
      'Часов работы','Направления откачки','Простой','Примечание'];
    var rRows = [rHdrs];
    var readings = DewateringState.meterReadings.slice().sort(function(a,b){ return b.date.localeCompare(a.date); });
    readings.forEach(function(r) {
      var pump = DewateringState.pumpById(r.pumpId);
      var sump = pump ? DewateringState.sumpById(pump.sumpId) : null;
      var st   = pump ? (DEW_PUMP_STATUS[pump.status] || DEW_PUMP_STATUS.off).label : '';
      var prevRec = DewateringState.lastActualReading(r.pumpId, r.date);
      var prevVal = prevRec
        ? (prevRec.isReset
            ? (prevRec.manualVolume != null ? parseFloat(prevRec.manualVolume) : (parseFloat(prevRec.resetStartValue) || 0))
            : parseFloat(prevRec.reading))
        : null;
      var vol = DewateringState.computedVolume(r);
      var dists = DewateringState.getDistributions(r).map(function(d) {
        var dest = DewateringState.destById(d.destinationId);
        return (dest ? dest.name : '?') + ' ' + d.pct + '%';
      }).join(' / ');
      rRows.push([
        r.date,
        pump ? (pump.quarry || '') : '[удалён]',
        sump ? sump.name : '[удалён]',
        pump ? pump.name : '[удалён: ' + r.pumpId + ']',
        st,
        prevVal != null ? prevVal : '',
        r.isStopped ? '' : (r.isReset ? '' : (r.reading != null ? r.reading : '')),
        vol != null ? Math.round(vol * 10) / 10 : '',
        r.hoursWorked != null ? r.hoursWorked : '',
        dists,
        r.isStopped ? 'Простой' : (r.isReset ? 'Замена счётчика' : ''),
        r.notes || ''
      ]);
    });
    var ws1 = XLSX.utils.aoa_to_sheet(rRows);
    ws1['!cols'] = [{wch:12},{wch:12},{wch:18},{wch:16},{wch:10},
      {wch:16},{wch:16},{wch:14},{wch:12},{wch:30},{wch:16},{wch:24}];
    rHdrs.forEach(function(_,ci) {
      var a = XLSX.utils.encode_cell({r:0,c:ci});
      if (ws1[a]) ws1[a].s = {font:{bold:true},fill:{fgColor:{rgb:'CFE2F3'}}};
    });

    // ── Лист 2: Реестр насосов ───────────────────────────────
    var pHdrs = ['Насос','Зумпф','Карьер','Статус','Тип','Марка/Модель',
      'Серийный №','Инв. №','Произв. м³/ч','Напор, м','Дата установки','∑ Объём, м³'];
    var pRows = [pHdrs];
    DewateringState.pumps.slice().sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); }).forEach(function(p) {
      var sump = DewateringState.sumpById(p.sumpId);
      var vol  = DewateringState.totalVolumePump(p.id);
      pRows.push([
        p.name, sump ? sump.name : '', p.quarry || '',
        (DEW_PUMP_STATUS[p.status] || DEW_PUMP_STATUS.off).label,
        DEW_PUMP_TYPE[p.type] || p.type || '',
        p.model || '', p.serialNumber || '', p.inventoryNumber || '',
        p.capacity != null ? p.capacity : '',
        p.head != null ? p.head : '',
        p.installDate || '',
        Math.round(vol * 10) / 10
      ]);
    });
    var ws2 = XLSX.utils.aoa_to_sheet(pRows);
    ws2['!cols'] = [{wch:16},{wch:18},{wch:14},{wch:12},{wch:12},{wch:16},
      {wch:16},{wch:14},{wch:12},{wch:10},{wch:14},{wch:14}];
    pHdrs.forEach(function(_,ci) {
      var a = XLSX.utils.encode_cell({r:0,c:ci});
      if (ws2[a]) ws2[a].s = {font:{bold:true},fill:{fgColor:{rgb:'CFE2F3'}}};
    });

    // ── Лист 3: Уровни воды ──────────────────────────────────
    var wHdrs = ['Дата','Зумпф','Отметка, м абс.','Примечание'];
    var wRows = [wHdrs];
    DewateringState.waterLevels.slice().sort(function(a,b){ return b.date.localeCompare(a.date); }).forEach(function(w) {
      var sump = DewateringState.sumpById(w.sumpId);
      wRows.push([w.date, sump ? sump.name : '', w.elevation != null ? w.elevation : '', w.notes || '']);
    });
    var ws3 = XLSX.utils.aoa_to_sheet(wRows);
    ws3['!cols'] = [{wch:12},{wch:18},{wch:16},{wch:30}];
    wHdrs.forEach(function(_,ci) {
      var a = XLSX.utils.encode_cell({r:0,c:ci});
      if (ws3[a]) ws3[a].s = {font:{bold:true},fill:{fgColor:{rgb:'CFE2F3'}}};
    });

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'Показания');
    XLSX.utils.book_append_sheet(wb, ws2, 'Насосы');
    XLSX.utils.book_append_sheet(wb, ws3, 'Уровни воды');
    XLSX.writeFile(wb, 'vodootliv-' + ts + '.xlsx');
    Toast.show('Excel сохранён', 'success');
  }

  if (window.XLSX) { doExport(); return; }
  var s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  s.onload = doExport;
  s.onerror = function() { Toast.show('Не удалось загрузить библиотеку Excel', 'error'); };
  document.head.appendChild(s);
}

// ── Helpers ──────────────────────────────────────────────────

function _dewFld(label, type, id, value, placeholder) {
  return '<div class="form-group"><label class="form-label">' + escHTML(label) + '</label>' +
    '<input type="' + type + '" id="' + id + '" class="form-control"' +
    ' value="' + escAttr(String(value != null ? value : '')) + '"' +
    (placeholder ? ' placeholder="' + escAttr(placeholder) + '"' : '') + '></div>';
}
