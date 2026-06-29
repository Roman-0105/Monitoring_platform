// ── Пылеподавление v1 ────────────────────────────────────────

var DustState = {
  orgs:     [],  // {id, name, notes}
  vehicles: [],  // {id, orgId, name, plateNumber, capacity, notes}
  nozzles:  [],  // {id, name, sourceType:'sump', sourceId, location, notes}
  logs:     [],  // {id, date, orgId, vehicleId, nozzleId, trips, totalVolume, manualVolume, isManualVolume, notes}

  _id: function(prefix) {
    return prefix + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  },

  load: function() {
    try {
      var raw = localStorage.getItem('dust_v1');
      var d = raw ? JSON.parse(raw) : {};
      this.orgs     = Array.isArray(d.orgs)     ? d.orgs     : [];
      this.vehicles = Array.isArray(d.vehicles)  ? d.vehicles : [];
      this.nozzles  = Array.isArray(d.nozzles)   ? d.nozzles  : [];
      this.logs     = Array.isArray(d.logs)      ? d.logs     : [];
    } catch(e) {
      this.orgs = []; this.vehicles = []; this.nozzles = []; this.logs = [];
    }
  },

  save: function() {
    localStorage.setItem('dust_v1', JSON.stringify({
      orgs: this.orgs, vehicles: this.vehicles,
      nozzles: this.nozzles, logs: this.logs,
    }));
  },

  loadFromSupabase: async function() {
    if (!window.Api) return false;
    try {
      var results = await Promise.all([
        Api.getDustOrgs(), Api.getDustVehicles(),
        Api.getDustNozzles(), Api.getDustLogs()
      ]);
      if (results.some(function(r) { return r.error; })) return false;
      this.orgs     = results[0].data.map(rowToDustOrg);
      this.vehicles = results[1].data.map(rowToDustVeh);
      this.nozzles  = results[2].data.map(rowToDustNozzle);
      this.logs     = results[3].data.map(rowToDustLog);
      this.save();
      return true;
    } catch(e) { return false; }
  },

  orgById:      function(id) { return this.orgs.find(function(x)     { return x.id === id; }); },
  vehicleById:  function(id) { return this.vehicles.find(function(x) { return x.id === id; }); },
  nozzleById:   function(id) { return this.nozzles.find(function(x)  { return x.id === id; }); },
  vehiclesOfOrg: function(orgId) {
    return this.vehicles.filter(function(v) { return v.orgId === orgId; });
  },

  addOrg: function(d) {
    d.id = this._id('org'); this.orgs.push(d); this.save();
    if (window.Api) Api.upsertDustOrg(dustOrgToRow(d)).catch(function() {});
    return d;
  },
  updateOrg: function(id, d) {
    var i = this.orgs.findIndex(function(x) { return x.id === id; });
    if (i >= 0) { this.orgs[i] = Object.assign({}, this.orgs[i], d); this.save();
      if (window.Api) Api.upsertDustOrg(dustOrgToRow(this.orgs[i])).catch(function() {}); }
  },
  deleteOrg: function(id) {
    var vIds = this.vehicles.filter(function(v) { return v.orgId === id; }).map(function(v) { return v.id; });
    this.orgs     = this.orgs.filter(function(x)     { return x.id !== id; });
    this.vehicles = this.vehicles.filter(function(v) { return v.orgId !== id; });
    this.logs     = this.logs.filter(function(l)     { return l.orgId !== id && vIds.indexOf(l.vehicleId) < 0; });
    this.save();
    if (window.Api) Api.deleteDustOrg(id).catch(function() {});
  },

  addVehicle: function(d) {
    d.id = this._id('veh'); this.vehicles.push(d); this.save();
    if (window.Api) Api.upsertDustVehicle(dustVehToRow(d)).catch(function() {});
    return d;
  },
  updateVehicle: function(id, d) {
    var i = this.vehicles.findIndex(function(x) { return x.id === id; });
    if (i >= 0) { this.vehicles[i] = Object.assign({}, this.vehicles[i], d); this.save();
      if (window.Api) Api.upsertDustVehicle(dustVehToRow(this.vehicles[i])).catch(function() {}); }
  },
  deleteVehicle: function(id) {
    this.vehicles = this.vehicles.filter(function(v) { return v.id !== id; });
    this.logs     = this.logs.filter(function(l)     { return l.vehicleId !== id; });
    this.save();
    if (window.Api) Api.deleteDustVehicle(id).catch(function() {});
  },

  addNozzle: function(d) {
    d.id = this._id('nzl'); this.nozzles.push(d); this.save();
    if (window.Api) Api.upsertDustNozzle(dustNozzleToRow(d)).catch(function() {});
    return d;
  },
  updateNozzle: function(id, d) {
    var i = this.nozzles.findIndex(function(x) { return x.id === id; });
    if (i >= 0) { this.nozzles[i] = Object.assign({}, this.nozzles[i], d); this.save();
      if (window.Api) Api.upsertDustNozzle(dustNozzleToRow(this.nozzles[i])).catch(function() {}); }
  },
  deleteNozzle: function(id) {
    this.nozzles = this.nozzles.filter(function(x) { return x.id !== id; });
    this.logs    = this.logs.filter(function(l)    { return l.nozzleId !== id; });
    this.save();
    if (window.Api) Api.deleteDustNozzle(id).catch(function() {});
  },

  addLog: function(d) {
    d.id = this._id('log'); this.logs.push(d); this.save();
    if (window.Api) Api.upsertDustLog(dustLogToRow(d)).catch(function() {});
    return d;
  },
  updateLog: function(id, d) {
    var i = this.logs.findIndex(function(x) { return x.id === id; });
    if (i >= 0) { this.logs[i] = Object.assign({}, this.logs[i], d); this.save();
      if (window.Api) Api.upsertDustLog(dustLogToRow(this.logs[i])).catch(function() {}); }
  },
  deleteLog: function(id) {
    this.logs = this.logs.filter(function(x) { return x.id !== id; });
    this.save();
    if (window.Api) Api.deleteDustLog(id).catch(function() {});
  },
};

// ── Module state ─────────────────────────────────────────────

var _dustInited   = false;
var _dustSubTab   = 'journal';
var _dustLogFilter = { dateFrom: '', dateTo: '', orgId: '', nozzleId: '' };
var _dustEditLogId = null;
var _dustVehicleFilter = '';

// Journal (meter-readings style) state
var _dustJournalDate         = '';
var _dustJournalOrgFilter    = '';
var _dustJournalNozzleFilter = '';
var _dustJRowSeq             = 0;

// ── Init ─────────────────────────────────────────────────────

function initDustTab() {
  DustState.load(); // immediate localStorage
  if (!_dustInited) {
    _dustInited = true;
    document.querySelectorAll('[data-dust-tab]').forEach(function(btn) {
      btn.addEventListener('click', function() { _dustSwitch(this.dataset.dustTab); });
    });
    // Async Supabase load — re-render when done
    DustState.loadFromSupabase().then(function(ok) {
      if (ok) _dustSwitch(_dustSubTab);
    });
  }
  _dustSwitch(_dustSubTab);
}

function _dustSwitch(tab) {
  _dustSubTab = tab;
  document.querySelectorAll('[data-dust-tab]').forEach(function(b) {
    b.classList.toggle('active', b.dataset.dustTab === tab);
  });
  document.querySelectorAll('.dew-panel[id^="dust-panel-"]').forEach(function(p) {
    p.classList.toggle('active', p.id === 'dust-panel-' + tab);
  });
  if (tab === 'journal')   _dustRenderJournal();
  if (tab === 'orgs')      _dustRenderOrgs();
  if (tab === 'nozzles')   _dustRenderNozzles();
  if (tab === 'analytics') _dustRenderAnalytics();
}

// ── Helpers ──────────────────────────────────────────────────

function _dustToday() {
  return new Date().toISOString().slice(0, 10);
}

function _dustFld(label, type, id, value, placeholder) {
  return '<div class="form-group"><label class="form-label">' + escHTML(label) + '</label>' +
    '<input type="' + type + '" id="' + id + '" class="form-control"' +
    ' value="' + escAttr(String(value != null ? value : '')) + '"' +
    (placeholder ? ' placeholder="' + escAttr(placeholder) + '"' : '') + '></div>';
}

function _dustOrgOpts(selected, emptyLabel) {
  var empty = emptyLabel || '— организация —';
  return '<option value="">' + escHTML(empty) + '</option>' +
    DustState.orgs.map(function(o) {
      return '<option value="' + escAttr(o.id) + '"' + (o.id === selected ? ' selected' : '') + '>' + escHTML(o.name) + '</option>';
    }).join('');
}

function _dustVehicleOpts(orgId, selected) {
  var vehicles = orgId ? DustState.vehiclesOfOrg(orgId) : DustState.vehicles;
  return '<option value="">— машина —</option>' +
    vehicles.map(function(v) {
      return '<option value="' + escAttr(v.id) + '"' + (v.id === selected ? ' selected' : '') + '>' +
        escHTML(v.name) + (v.plateNumber ? ' (' + escHTML(v.plateNumber) + ')' : '') + '</option>';
    }).join('');
}

function _dustNozzleOpts(selected, emptyLabel) {
  var empty = emptyLabel || '— гусак —';
  return '<option value="">' + escHTML(empty) + '</option>' +
    DustState.nozzles.map(function(n) {
      var sumpName = '';
      if (n.sourceType === 'sump' && n.sourceId && typeof DewateringState !== 'undefined') {
        var sump = DewateringState.sumpById(n.sourceId);
        if (sump) sumpName = ' [' + sump.name + ']';
      }
      return '<option value="' + escAttr(n.id) + '"' + (n.id === selected ? ' selected' : '') + '>' +
        escHTML(n.name) + escHTML(sumpName) + '</option>';
    }).join('');
}

function _dustSumpOpts(selected) {
  if (typeof DewateringState === 'undefined') return '<option value="">— зумпф недоступен —</option>';
  return '<option value="">— зумпф —</option>' +
    DewateringState.sumps.map(function(s) {
      return '<option value="' + escAttr(s.id) + '"' + (s.id === selected ? ' selected' : '') + '>' + escHTML(s.name) + '</option>';
    }).join('');
}

function _dustComputeVolume(log) {
  if (log.isManualVolume) return parseFloat(log.manualVolume) || 0;
  var vehicle = DustState.vehicleById(log.vehicleId);
  if (!vehicle) return 0;
  return (parseFloat(log.trips) || 0) * (parseFloat(vehicle.capacity) || 0);
}

function _dustNozzleVolumeMonth(nozzleId) {
  var now = new Date();
  var monthStart = now.toISOString().slice(0, 7) + '-01';
  var monthEnd   = now.toISOString().slice(0, 10);
  return DustState.logs
    .filter(function(l) { return l.nozzleId === nozzleId && l.date >= monthStart && l.date <= monthEnd; })
    .reduce(function(a, l) { return a + _dustComputeVolume(l); }, 0);
}

// ── Журнал ───────────────────────────────────────────────────

function _dustJournalGoDay(delta) {
  var inp = document.getElementById('dust-j-date');
  if (!inp || !inp.value) return;
  var p = inp.value.split('-').map(Number);
  var d = new Date(p[0], p[1] - 1, p[2]); // local midnight, no UTC shift
  d.setDate(d.getDate() + delta);
  _dustJournalDate = d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
  inp.value = _dustJournalDate;
  _dustRenderJournalLeft();
}

function _dustJournalPrevDay() { _dustJournalGoDay(-1); }
function _dustJournalNextDay() { _dustJournalGoDay(1); }

function _dustRenderJournal() {
  var el = document.getElementById('dust-panel-journal');
  if (!el) return;

  if (!_dustJournalDate) _dustJournalDate = _dustToday();

  el.innerHTML =
    // Top bar
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:8px 10px;background:var(--bg-2);border-radius:var(--r);border:1px solid var(--line)">' +
      '<button class="btn btn-sm" style="padding:2px 8px;font-size:16px;line-height:1" onclick="_dustJournalPrevDay()">←</button>' +
      '<input type="date" id="dust-j-date" class="form-control" value="' + escAttr(_dustJournalDate) + '" style="width:140px;font-size:12px" onchange="_dustJournalDate=this.value;_dustRenderJournalLeft()">' +
      '<button class="btn btn-sm" style="padding:2px 8px;font-size:16px;line-height:1" onclick="_dustJournalNextDay()">→</button>' +
      '<select id="dust-j-org" class="form-control" style="font-size:11px;width:140px" onchange="_dustJournalOrgFilter=this.value;_dustRenderJournalLeft()">' +
        _dustOrgOpts(_dustJournalOrgFilter, 'Все орг.') +
      '</select>' +
      '<select id="dust-j-nozzle" class="form-control" style="font-size:11px;width:140px" onchange="_dustJournalNozzleFilter=this.value;_dustRenderJournalLeft()">' +
        _dustNozzleOpts(_dustJournalNozzleFilter, 'Все гусаки') +
      '</select>' +
      '<button class="btn btn-sm" style="background:var(--gold);color:#000;margin-left:auto" onclick="_dustJournalSaveAll()">💾 Сохранить всё</button>' +
    '</div>' +
    // Two-column layout
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start">' +
      '<div id="dust-j-left"></div>' +
      // RIGHT: history
      '<div>' +
        '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3);margin-bottom:8px">История</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;padding:8px 10px;background:var(--bg-2);border-radius:var(--r);border:1px solid var(--line)">' +
          '<span style="font-size:11px;color:var(--txt-3)">С:</span>' +
          '<input type="date" id="dust-filter-from" class="form-control" value="' + escAttr(_dustLogFilter.dateFrom) + '" style="width:130px;font-size:11px" oninput="_dustLogFilter.dateFrom=this.value;_dustRenderLogTable()">' +
          '<span style="font-size:11px;color:var(--txt-3)">По:</span>' +
          '<input type="date" id="dust-filter-to" class="form-control" value="' + escAttr(_dustLogFilter.dateTo) + '" style="width:130px;font-size:11px" oninput="_dustLogFilter.dateTo=this.value;_dustRenderLogTable()">' +
          '<select id="dust-filter-org" class="form-control" style="font-size:11px;width:130px" onchange="_dustLogFilter.orgId=this.value;_dustRenderLogTable()">' + _dustOrgOpts(_dustLogFilter.orgId, 'Все орг.') + '</select>' +
          '<select id="dust-filter-nozzle" class="form-control" style="font-size:11px;width:130px" onchange="_dustLogFilter.nozzleId=this.value;_dustRenderLogTable()">' + _dustNozzleOpts(_dustLogFilter.nozzleId, 'Все гусаки') + '</select>' +
        '</div>' +
        '<div id="dust-log-table"></div>' +
        '<div id="dust-log-summary" style="font-size:11px;color:var(--txt-3);margin-top:8px;padding-top:8px;border-top:1px solid var(--line)"></div>' +
      '</div>' +
    '</div>';

  _dustRenderJournalLeft();
  _dustRenderLogTable();
}

function _dustRenderJournalLeft() {
  var el = document.getElementById('dust-j-left');
  if (!el) return;

  var date = _dustJournalDate || _dustToday();

  // Determine which orgs to show
  var orgs = _dustJournalOrgFilter
    ? DustState.orgs.filter(function(o) { return o.id === _dustJournalOrgFilter; })
    : DustState.orgs;

  if (orgs.length === 0 || DustState.vehicles.length === 0) {
    el.innerHTML = '<div style="color:var(--txt-3);font-size:12px;padding:16px 0">Нет машин. Добавьте организацию и машины.</div>';
    return;
  }

  var html = '';
  var anyOrg = false;

  orgs.forEach(function(org) {
    var vehicles = DustState.vehiclesOfOrg(org.id);
    if (vehicles.length === 0) return;
    anyOrg = true;

    // Org total volume for the day
    var orgDayVol = 0;
    vehicles.forEach(function(v) {
      DustState.logs.forEach(function(l) {
        if (l.vehicleId === v.id && l.date === date &&
            (!_dustJournalNozzleFilter || l.nozzleId === _dustJournalNozzleFilter)) {
          orgDayVol += _dustComputeVolume(l);
        }
      });
    });

    // Org section card (like sump card in meter readings)
    html += '<div class="card" style="padding:12px 14px;margin-bottom:8px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">';
    html += '<div style="font-size:11px;font-weight:600;color:var(--txt-1)">' + escHTML(org.name) + '</div>';
    if (orgDayVol > 0) {
      html += '<div style="font-size:11px;color:var(--gold);font-weight:600">' + orgDayVol.toFixed(1) + ' м³</div>';
    }
    html += '</div>';

    // Vehicles inside org card (like pumps inside sump card)
    vehicles.forEach(function(v) {
      var cap = parseFloat(v.capacity) || 0;

      var existingLogs = DustState.logs.filter(function(l) {
        return l.vehicleId === v.id && l.date === date &&
          (!_dustJournalNozzleFilter || l.nozzleId === _dustJournalNozzleFilter);
      });

      var dayVol = existingLogs.reduce(function(a, l) { return a + _dustComputeVolume(l); }, 0);

      // Vehicle sub-section with top border (like pump row)
      html += '<div class="dust-j-card" data-vehicle-id="' + escAttr(v.id) + '"' +
        ' style="padding:8px 0;border-top:1px solid var(--line-2)">';

      // Vehicle header row
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
      html += '<div style="display:flex;align-items:center;gap:6px">';
      html += '<span style="font-size:12px;font-weight:600;color:var(--txt-1)">' + escHTML(v.name) + '</span>';
      if (v.plateNumber) html += '<span style="font-size:10px;color:var(--txt-3)">(' + escHTML(v.plateNumber) + ')</span>';
      html += '</div>';
      html += '<span style="font-size:10px;color:var(--txt-3)">';
      if (dayVol > 0) html += '<b style="color:var(--gold);margin-right:4px">' + dayVol.toFixed(1) + ' м³</b>';
      if (cap > 0) html += cap + ' м³/рейс';
      html += '</span>';
      html += '</div>';

      // Nozzle rows container
      html += '<div id="dust-jrows-' + escAttr(v.id) + '">';

      if (existingLogs.length > 0) {
        existingLogs.forEach(function(log) {
          _dustJRowSeq++;
          var rowId = 'djr' + _dustJRowSeq;
          html += _dustJRowHTML(rowId, log.nozzleId, log.trips, log.notes, log.id);
        });
      } else {
        _dustJRowSeq++;
        var rowId = 'djr' + _dustJRowSeq;
        // Pre-select vehicle's default nozzle, fall back to active nozzle filter
        html += _dustJRowHTML(rowId, v.defaultNozzleId || _dustJournalNozzleFilter, 0, '', '');
      }

      html += '</div>';
      html += '<button class="btn btn-sm" style="font-size:11px;margin-top:4px;opacity:.7"' +
        ' onclick="_dustJAddRow(\'' + escAttr(v.id) + '\')">+ Гусак</button>';
      html += '</div>'; // end vehicle
    });

    html += '</div>'; // end org card
  });

  if (!anyOrg) {
    html = '<div style="color:var(--txt-3);font-size:12px;padding:16px 0">Нет машин. Добавьте организацию и машины.</div>';
  }

  el.innerHTML = html;
}

function _dustJRowHTML(rowId, nozzleId, trips, notes, logId) {
  var tripsVal = trips > 0 ? String(trips) : '';
  return '<div class="dust-jr" id="' + escAttr(rowId) + '" data-log-id="' + escAttr(logId || '') + '"' +
    ' style="display:flex;align-items:center;gap:5px;margin-bottom:5px">' +
    '<select class="dust-jr-nozzle form-control" style="flex:1;min-width:0;font-size:11px"' +
    ' onchange="_dustJRowUpdateVol(\'' + escAttr(rowId) + '\')">' +
    _dustNozzleOpts(nozzleId || _dustJournalNozzleFilter, '— гусак —') +
    '</select>' +
    '<input class="dust-jr-trips form-control" type="number" min="0"' +
    ' style="width:56px;font-size:12px;text-align:right" value="' + escAttr(tripsVal) + '"' +
    ' oninput="_dustJRowUpdateVol(\'' + escAttr(rowId) + '\')">' +
    '<span style="font-size:10px;color:var(--txt-3);white-space:nowrap">рейс.</span>' +
    '<span id="' + escAttr(rowId) + '-v" style="font-size:10px;min-width:62px;text-align:right;white-space:nowrap">→ —</span>' +
    '<input class="dust-jr-notes form-control" type="text" placeholder="Примечание"' +
    ' style="width:100px;font-size:10px" value="' + escAttr(notes || '') + '">' +
    '<button class="btn btn-sm" style="padding:1px 6px;font-size:12px;opacity:.6"' +
    ' onclick="document.getElementById(\'' + escAttr(rowId) + '\').remove()">✕</button>' +
    '</div>';
}

function _dustJRowUpdateVol(rowId) {
  var rowEl = document.getElementById(rowId);
  if (!rowEl) return;
  var cardEl = rowEl.closest('.dust-j-card');
  if (!cardEl) return;
  var vehicleId = cardEl.dataset.vehicleId;
  var vehicle = vehicleId ? DustState.vehicleById(vehicleId) : null;
  var cap = vehicle ? (parseFloat(vehicle.capacity) || 0) : 0;
  var trips = parseFloat((rowEl.querySelector('.dust-jr-trips') || {}).value) || 0;
  var volEl = document.getElementById(rowId + '-v');
  if (!volEl) return;
  if (cap > 0 && trips > 0) {
    volEl.textContent = '→ ' + (trips * cap).toFixed(1) + ' м³';
    volEl.style.color = 'var(--gold)';
  } else if (cap > 0) {
    volEl.textContent = '→ —';
    volEl.style.color = 'var(--txt-3)';
  } else {
    volEl.textContent = '→ —';
    volEl.style.color = 'var(--txt-3)';
  }
}

function _dustJAddRow(vehicleId) {
  var container = document.getElementById('dust-jrows-' + vehicleId);
  if (!container) return;
  _dustJRowSeq++;
  var rowId = 'djr' + _dustJRowSeq;
  var div = document.createElement('div');
  div.innerHTML = _dustJRowHTML(rowId, _dustJournalNozzleFilter, 0, '', '');
  container.appendChild(div.firstChild);
}

function _dustJournalSaveAll() {
  var date = _dustJournalDate || _dustToday();
  var saved = 0;

  document.querySelectorAll('.dust-j-card').forEach(function(card) {
    var vehicleId = card.dataset.vehicleId;
    if (!vehicleId) return;
    var vehicle = DustState.vehicleById(vehicleId);
    if (!vehicle) return;

    // Collect rows with trips > 0 and a nozzle selected
    var rows = [];
    card.querySelectorAll('.dust-jr').forEach(function(rowEl) {
      var nozzleId = (rowEl.querySelector('.dust-jr-nozzle') || {}).value || '';
      var trips    = parseFloat((rowEl.querySelector('.dust-jr-trips') || {}).value) || 0;
      var notes    = ((rowEl.querySelector('.dust-jr-notes') || {}).value || '').trim();
      if (!nozzleId || trips <= 0) return;
      rows.push({ nozzleId: nozzleId, trips: trips, notes: notes });
    });

    // Delete existing logs for this vehicle + date (respecting nozzle filter)
    var toDelete = DustState.logs.filter(function(l) {
      return l.vehicleId === vehicleId && l.date === date &&
        (!_dustJournalNozzleFilter || l.nozzleId === _dustJournalNozzleFilter);
    }).map(function(l) { return l.id; });

    toDelete.forEach(function(id) { DustState.deleteLog(id); });

    // Add new logs
    rows.forEach(function(row) {
      var cap = parseFloat(vehicle.capacity) || 0;
      DustState.addLog({
        date: date,
        orgId: vehicle.orgId,
        vehicleId: vehicleId,
        nozzleId: row.nozzleId,
        trips: row.trips,
        totalVolume: row.trips * cap,
        isManualVolume: false,
        manualVolume: null,
        notes: row.notes,
      });
      saved++;
    });
  });

  Toast.show('Сохранено: ' + saved + ' ' + (saved === 1 ? 'запись' : saved < 5 ? 'записи' : 'записей'), 'success');

  // Advance to the next day (same local-safe logic as _dustJournalGoDay)
  var dp = date.split('-').map(Number);
  var nd = new Date(dp[0], dp[1] - 1, dp[2]);
  nd.setDate(nd.getDate() + 1);
  _dustJournalDate = nd.getFullYear() + '-' +
    String(nd.getMonth() + 1).padStart(2, '0') + '-' +
    String(nd.getDate()).padStart(2, '0');
  var dateInp = document.getElementById('dust-j-date');
  if (dateInp) dateInp.value = _dustJournalDate;

  _dustRenderJournalLeft();
  _dustRenderLogTable();
}

function _dustRenderLogTable() {
  var el    = document.getElementById('dust-log-table');
  var sumEl = document.getElementById('dust-log-summary');
  if (!el) return;

  var logs = DustState.logs.filter(function(l) {
    if (_dustLogFilter.dateFrom && l.date < _dustLogFilter.dateFrom) return false;
    if (_dustLogFilter.dateTo   && l.date > _dustLogFilter.dateTo)   return false;
    if (_dustLogFilter.orgId    && l.orgId    !== _dustLogFilter.orgId)    return false;
    if (_dustLogFilter.nozzleId && l.nozzleId !== _dustLogFilter.nozzleId) return false;
    return true;
  }).slice().sort(function(a, b) { return b.date.localeCompare(a.date); });

  var totalVol = logs.reduce(function(a, l) { return a + _dustComputeVolume(l); }, 0);
  if (sumEl) sumEl.innerHTML = logs.length + ' записей · <b style="color:var(--txt-1)">' + totalVol.toFixed(1) + ' м³</b> итого';

  if (!logs.length) {
    el.innerHTML = '<div class="card" style="padding:16px;text-align:center;color:var(--txt-3);font-size:12px">' +
      (DustState.logs.length ? 'Нет данных по выбранным фильтрам' : 'Записей нет — добавьте первую запись слева') + '</div>';
    return;
  }

  el.innerHTML = '<div style="overflow-x:auto;max-height:480px;overflow-y:auto">' +
    '<table style="width:100%;border-collapse:collapse;font-size:11px;min-width:520px">' +
    '<thead style="position:sticky;top:0;background:var(--bg-2);z-index:1"><tr style="color:var(--txt-3);border-bottom:1px solid var(--line);font-size:10px;text-transform:uppercase">' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Дата</th>' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Организация</th>' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Машина</th>' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Гусак</th>' +
      '<th style="padding:6px 8px;text-align:right;font-weight:500">Рейсы</th>' +
      '<th style="padding:6px 8px;text-align:right;font-weight:500">Объём м³</th>' +
      '<th style="padding:6px 8px;font-weight:500">Примечание</th>' +
      '<th style="padding:6px 8px"></th>' +
    '</tr></thead><tbody>' +
    logs.map(function(l) {
      var org     = DustState.orgById(l.orgId);
      var vehicle = DustState.vehicleById(l.vehicleId);
      var nozzle  = DustState.nozzleById(l.nozzleId);
      var vol     = _dustComputeVolume(l);
      var isEditing = l.id === _dustEditLogId;

      var dataRow =
        '<tr style="border-bottom:' + (isEditing ? 'none' : '1px solid var(--line-2)') + (isEditing ? ';background:rgba(255,255,255,.03)' : '') + '">' +
        '<td style="padding:5px 8px;color:var(--txt-1);white-space:nowrap">' + escHTML(l.date) + '</td>' +
        '<td style="padding:5px 8px;color:var(--txt-2)">' + (org ? escHTML(org.name) : '<span style="color:var(--txt-3)">—</span>') + '</td>' +
        '<td style="padding:5px 8px">' +
          '<div style="color:var(--txt-1)">' + (vehicle ? escHTML(vehicle.name) : '<span style="color:var(--txt-3)">—</span>') + '</div>' +
          (vehicle && vehicle.plateNumber ? '<div style="font-size:9px;color:var(--txt-3)">' + escHTML(vehicle.plateNumber) + '</div>' : '') +
        '</td>' +
        '<td style="padding:5px 8px;color:var(--txt-2)">' + (nozzle ? escHTML(nozzle.name) : '<span style="color:var(--txt-3)">—</span>') + '</td>' +
        '<td style="padding:5px 8px;text-align:right;color:var(--txt-2)">' + (l.trips || '—') + '</td>' +
        '<td style="padding:5px 8px;text-align:right;color:var(--ok);font-weight:600">' + vol.toFixed(1) + (l.isManualVolume ? '<span style="color:var(--txt-3);font-weight:400" title="Вручную"> ✎</span>' : '') + '</td>' +
        '<td style="padding:5px 8px;color:var(--txt-3);font-size:10px">' + (l.notes ? escHTML(l.notes) : '—') + '</td>' +
        '<td style="padding:5px 8px;text-align:right;white-space:nowrap">' +
          '<button class="btn btn-sm btn-outline" title="Редактировать" style="font-size:10px;padding:2px 5px;margin-right:3px" onclick="_dustEditLog(\'' + l.id + '\')">' + (isEditing ? '✕' : '✎') + '</button>' +
          (!isEditing ? '<button class="btn btn-sm" style="font-size:10px;padding:2px 5px;background:rgba(248,113,113,.1);color:var(--bad);border:1px solid rgba(248,113,113,.2)" onclick="_dustDeleteLog(\'' + l.id + '\')">✕</button>' : '') +
        '</td>' +
        '</tr>';

      if (!isEditing) return dataRow;

      var editRow = _dustLogEditRow(l);
      return dataRow + editRow;
    }).join('') +
    '</tbody></table></div>';
}

function _dustLogEditRow(l) {
  var orgId     = l.orgId || '';
  var vehicleId = l.vehicleId || '';
  var nozzleId  = l.nozzleId || '';
  return '<tr style="background:var(--bg-3);border-bottom:1px solid var(--line)">' +
    '<td colspan="8" style="padding:10px 12px">' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label" style="font-size:9px">Дата</label>' +
          '<input type="date" id="dust-er-date-' + l.id + '" class="form-control" value="' + escAttr(l.date) + '" style="width:132px;font-size:11px">' +
        '</div>' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label" style="font-size:9px">Организация</label>' +
          '<select id="dust-er-org-' + l.id + '" class="form-control" style="font-size:11px;width:140px" onchange="_dustErOrgChange(\'' + l.id + '\')">' + _dustOrgOpts(orgId) + '</select>' +
        '</div>' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label" style="font-size:9px">Машина</label>' +
          '<select id="dust-er-vehicle-' + l.id + '" class="form-control" style="font-size:11px;width:160px">' + _dustVehicleOpts(orgId, vehicleId) + '</select>' +
        '</div>' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label" style="font-size:9px">Гусак</label>' +
          '<select id="dust-er-nozzle-' + l.id + '" class="form-control" style="font-size:11px;width:140px">' + _dustNozzleOpts(nozzleId) + '</select>' +
        '</div>' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label" style="font-size:9px">Рейсов</label>' +
          '<input type="number" id="dust-er-trips-' + l.id + '" class="form-control" value="' + escAttr(String(l.trips != null ? l.trips : '')) + '" style="width:80px;font-size:11px">' +
        '</div>' +
        '<div class="form-group" style="margin:0">' +
          '<label class="form-label" style="font-size:9px">Примечание</label>' +
          '<input type="text" id="dust-er-notes-' + l.id + '" class="form-control" value="' + escAttr(l.notes || '') + '" style="min-width:120px;font-size:11px">' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-top:8px">' +
        '<label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--txt-3);cursor:pointer">' +
          '<input type="checkbox" id="dust-er-manual-chk-' + l.id + '"' + (l.isManualVolume ? ' checked' : '') + ' onchange="_dustErToggleManual(\'' + l.id + '\')">' +
          ' Ввести объём вручную' +
        '</label>' +
        '<div id="dust-er-manual-wrap-' + l.id + '"' + (!l.isManualVolume ? ' style="display:none"' : '') + '>' +
          '<input type="number" id="dust-er-manual-vol-' + l.id + '" class="form-control" value="' + escAttr(String(l.manualVolume != null ? l.manualVolume : '')) + '" placeholder="м³" style="width:100px;font-size:11px">' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;margin-top:10px">' +
        '<button class="btn btn-sm" style="background:var(--gold);color:#000;font-size:11px" onclick="_dustSaveEditLog(\'' + l.id + '\')">Сохранить</button>' +
        '<button class="btn btn-sm btn-outline" style="font-size:11px" onclick="_dustCancelEditLog()">Отмена</button>' +
      '</div>' +
    '</td>' +
    '</tr>';
}

function _dustErOrgChange(logId) {
  var orgSel = document.getElementById('dust-er-org-' + logId);
  var vehSel = document.getElementById('dust-er-vehicle-' + logId);
  if (!orgSel || !vehSel) return;
  vehSel.innerHTML = _dustVehicleOpts(orgSel.value, '');
}

function _dustErToggleManual(logId) {
  var chk  = document.getElementById('dust-er-manual-chk-' + logId);
  var wrap = document.getElementById('dust-er-manual-wrap-' + logId);
  if (!chk || !wrap) return;
  wrap.style.display = chk.checked ? '' : 'none';
}

function _dustEditLog(id) {
  _dustEditLogId = (_dustEditLogId === id) ? null : id;
  _dustRenderLogTable();
}

function _dustCancelEditLog() {
  _dustEditLogId = null;
  _dustRenderLogTable();
}

function _dustSaveEditLog(id) {
  var l = DustState.logs.find(function(x) { return x.id === id; });
  if (!l) return;
  var isManual = !!(document.getElementById('dust-er-manual-chk-' + id) || {}).checked;
  var trips    = parseFloat((document.getElementById('dust-er-trips-' + id) || {}).value) || 0;
  var vehicleId = ((document.getElementById('dust-er-vehicle-' + id) || {}).value) || l.vehicleId;
  var manualVol = parseFloat((document.getElementById('dust-er-manual-vol-' + id) || {}).value) || 0;
  var vehicle   = DustState.vehicleById(vehicleId);
  var totalVolume = isManual ? manualVol : (trips * (parseFloat((vehicle || {}).capacity) || 0));

  DustState.updateLog(id, {
    date:          ((document.getElementById('dust-er-date-'  + id) || {}).value) || l.date,
    orgId:         ((document.getElementById('dust-er-org-'   + id) || {}).value) || l.orgId,
    vehicleId:     vehicleId,
    nozzleId:      ((document.getElementById('dust-er-nozzle-' + id) || {}).value) || l.nozzleId,
    trips:         trips,
    totalVolume:   totalVolume,
    isManualVolume: isManual,
    manualVolume:  isManual ? manualVol : null,
    notes:         ((document.getElementById('dust-er-notes-' + id) || {}).value || '').trim(),
  });
  _dustEditLogId = null;
  _dustRenderLogTable();
  Toast.show('Запись обновлена', 'success');
}

function _dustDeleteLog(id) {
  if (!confirm('Удалить запись?')) return;
  DustState.deleteLog(id);
  if (_dustEditLogId === id) _dustEditLogId = null;
  _dustRenderLogTable();
  Toast.show('Запись удалена', 'info');
}

// ── Организации и машины ─────────────────────────────────────

function _dustRenderOrgs() {
  var el = document.getElementById('dust-panel-orgs');
  if (!el) return;

  el.innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start">' +
      // LEFT: orgs
      '<div>' +
        '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3);margin-bottom:8px">Организации</div>' +
        '<div id="dust-org-list"></div>' +
        '<div class="card" style="padding:14px;margin-top:10px">' +
          '<div style="font-size:11px;color:var(--txt-3);margin-bottom:8px">Добавить организацию</div>' +
          _dustFld('Название', 'text', 'dust-org-name', '', 'ООО Транспорт...') +
          _dustFld('Примечание', 'text', 'dust-org-notes', '', '') +
          '<button class="btn btn-sm" style="background:var(--gold);color:#000" onclick="_dustAddOrg()">Добавить</button>' +
        '</div>' +
      '</div>' +
      // RIGHT: vehicles
      '<div>' +
        '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3);margin-bottom:8px">Машины / цистерны</div>' +
        '<div style="margin-bottom:8px">' +
          '<select id="dust-vehicle-filter-org" class="form-control" style="font-size:12px;width:200px" onchange="_dustVehicleFilter=this.value;_dustRenderVehicleList()">' + _dustOrgOpts(_dustVehicleFilter, 'Все организации') + '</select>' +
        '</div>' +
        '<div id="dust-vehicle-list"></div>' +
        '<div id="dust-vehicle-form"></div>' +
        '<div class="card" style="padding:14px;margin-top:10px">' +
          '<div style="font-size:11px;font-weight:600;color:var(--txt-3);margin-bottom:8px">Добавить машину</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div class="form-group"><label class="form-label">Организация</label>' +
              '<select id="dust-veh-org" class="form-control">' + _dustOrgOpts('') + '</select>' +
            '</div>' +
            _dustFld('Название', 'text', 'dust-veh-name', '', 'КамАЗ-65115') +
            _dustFld('Гос. номер', 'text', 'dust-veh-plate', '', 'А001АА 15') +
            _dustFld('Объём цистерны, м³', 'number', 'dust-veh-cap', '', '10') +
            '<div class="form-group"><label class="form-label">Гусак по умолчанию</label>' +
              '<select id="dust-veh-nozzle" class="form-control">' + _dustNozzleOpts('', 'Не задан') + '</select>' +
            '</div>' +
            _dustFld('Примечание', 'text', 'dust-veh-notes', '', '') +
          '</div>' +
          '<button class="btn btn-sm" style="background:var(--gold);color:#000;margin-top:4px" onclick="_dustAddVehicle()">Добавить машину</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  _dustRenderOrgList();
  _dustRenderVehicleList();
}

function _dustRenderOrgList() {
  var el = document.getElementById('dust-org-list');
  if (!el) return;
  if (!DustState.orgs.length) {
    el.innerHTML = '<div class="card" style="padding:14px;text-align:center;color:var(--txt-3);font-size:12px">Организации не добавлены</div>';
    return;
  }
  el.innerHTML = DustState.orgs.map(function(org) {
    var vCount = DustState.vehiclesOfOrg(org.id).length;
    return '<div class="card" style="padding:10px 12px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:8px">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:600;color:var(--txt-1);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHTML(org.name) + '</div>' +
        '<div style="font-size:10px;color:var(--txt-3)">Машин: ' + vCount + (org.notes ? ' · ' + escHTML(org.notes) : '') + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:4px;flex-shrink:0">' +
        '<button class="btn btn-sm btn-outline" style="font-size:10px;padding:2px 7px" onclick="_dustEditOrgPrompt(\'' + org.id + '\')">✎</button>' +
        '<button class="btn btn-sm" style="font-size:10px;padding:2px 7px;background:rgba(248,113,113,.1);color:var(--bad);border:1px solid rgba(248,113,113,.2)" onclick="_dustDeleteOrg(\'' + org.id + '\')">✕</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function _dustRenderVehicleList() {
  var el = document.getElementById('dust-vehicle-list');
  if (!el) return;
  var vehicles = _dustVehicleFilter ? DustState.vehiclesOfOrg(_dustVehicleFilter) : DustState.vehicles;
  if (!vehicles.length) {
    el.innerHTML = '<div class="card" style="padding:14px;text-align:center;color:var(--txt-3);font-size:12px">' +
      (DustState.vehicles.length ? 'Нет машин в выбранной организации' : 'Машины не добавлены') + '</div>';
    return;
  }
  el.innerHTML = '<div style="overflow-x:auto">' +
    '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
    '<thead><tr style="color:var(--txt-3);font-size:10px;text-transform:uppercase;border-bottom:1px solid var(--line)">' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Название</th>' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Гос. номер</th>' +
      '<th style="padding:6px 8px;text-align:right;font-weight:500">Объём, м³</th>' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Организация</th>' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Гусак по умолч.</th>' +
      '<th style="padding:6px 8px"></th>' +
    '</tr></thead><tbody>' +
    vehicles.map(function(v) {
      var org    = DustState.orgById(v.orgId);
      var nozzle = v.defaultNozzleId ? DustState.nozzleById(v.defaultNozzleId) : null;
      return '<tr style="border-bottom:1px solid var(--line-2)">' +
        '<td style="padding:5px 8px;color:var(--txt-1)">' + escHTML(v.name) + '</td>' +
        '<td style="padding:5px 8px;color:var(--txt-2)">' + (v.plateNumber ? escHTML(v.plateNumber) : '—') + '</td>' +
        '<td style="padding:5px 8px;text-align:right;color:var(--txt-1);font-weight:600">' + (v.capacity != null && v.capacity !== '' ? parseFloat(v.capacity).toFixed(1) : '—') + '</td>' +
        '<td style="padding:5px 8px;color:var(--txt-3);font-size:10px">' + (org ? escHTML(org.name) : '—') + '</td>' +
        '<td style="padding:5px 8px;color:var(--txt-2);font-size:10px">' + (nozzle ? escHTML(nozzle.name) : '<span style="color:var(--txt-3)">—</span>') + '</td>' +
        '<td style="padding:5px 8px;text-align:right;white-space:nowrap">' +
          '<button class="btn btn-sm btn-outline" style="font-size:10px;padding:2px 5px;margin-right:3px" onclick="_dustOpenVehicleForm(\'' + v.id + '\')">✎</button>' +
          '<button class="btn btn-sm" style="font-size:10px;padding:2px 5px;background:rgba(248,113,113,.1);color:var(--bad);border:1px solid rgba(248,113,113,.2)" onclick="_dustDeleteVehicle(\'' + v.id + '\')">✕</button>' +
        '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table></div>';
}

function _dustOpenVehicleForm(id) {
  var v = DustState.vehicleById(id);
  if (!v) return;
  var formEl = document.getElementById('dust-vehicle-form');
  if (!formEl) return;

  var orgOpts = DustState.orgs.map(function(o) {
    return '<option value="' + escAttr(o.id) + '"' + (o.id === v.orgId ? ' selected' : '') + '>' + escHTML(o.name) + '</option>';
  }).join('');

  formEl.innerHTML =
    '<div class="card" style="padding:14px;margin-top:8px;border:1px solid rgba(34,211,238,.3)">' +
    '<div style="font-size:12px;font-weight:600;color:var(--gold);margin-bottom:10px">Редактировать машину</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '<div class="form-group"><label class="form-label">Организация</label>' +
        '<select id="dust-vf-org" class="form-control"><option value="">' + escHTML('— организация —') + '</option>' + orgOpts + '</select>' +
      '</div>' +
      _dustFld('Название', 'text', 'dust-vf-name', v.name, '') +
      _dustFld('Гос. номер', 'text', 'dust-vf-plate', v.plateNumber || '', '') +
      _dustFld('Объём цистерны, м³', 'number', 'dust-vf-cap', v.capacity != null ? v.capacity : '', '') +
      '<div class="form-group"><label class="form-label">Гусак по умолчанию</label>' +
        '<select id="dust-vf-nozzle" class="form-control">' + _dustNozzleOpts(v.defaultNozzleId || '', 'Не задан') + '</select>' +
      '</div>' +
      _dustFld('Примечание', 'text', 'dust-vf-notes', v.notes || '', '') +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:10px">' +
      '<button class="btn btn-sm" style="background:var(--gold);color:#000" id="dust-vf-save">Сохранить</button>' +
      '<button class="btn btn-sm btn-outline" id="dust-vf-cancel">Отмена</button>' +
    '</div></div>';

  formEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  document.getElementById('dust-vf-cancel').onclick = function() { formEl.innerHTML = ''; };
  document.getElementById('dust-vf-save').onclick = function() {
    var name  = (document.getElementById('dust-vf-name').value || '').trim();
    if (!name) { Toast.show('Введите название машины', 'warning'); return; }
    var capStr = (document.getElementById('dust-vf-cap').value || '').trim();
    DustState.updateVehicle(id, {
      orgId:          document.getElementById('dust-vf-org').value    || v.orgId,
      name:           name,
      plateNumber:    (document.getElementById('dust-vf-plate').value  || '').trim(),
      capacity:       capStr !== '' ? parseFloat(capStr) : null,
      defaultNozzleId: document.getElementById('dust-vf-nozzle').value || '',
      notes:          (document.getElementById('dust-vf-notes').value  || '').trim(),
    });
    formEl.innerHTML = '';
    Toast.show('Машина обновлена', 'success');
    _dustRenderVehicleList();
  };
}

function _dustAddOrg() {
  var name  = ((document.getElementById('dust-org-name')  || {}).value || '').trim();
  var notes = ((document.getElementById('dust-org-notes') || {}).value || '').trim();
  if (!name) { Toast.show('Введите название организации', 'warning'); return; }
  DustState.addOrg({ name: name, notes: notes });
  document.getElementById('dust-org-name').value  = '';
  document.getElementById('dust-org-notes').value = '';
  Toast.show('Организация добавлена', 'success');
  _dustRenderOrgList();
  _dustRefreshOrgSelects();
}

function _dustEditOrgPrompt(id) {
  var org = DustState.orgById(id);
  if (!org) return;
  var name = prompt('Название организации:', org.name);
  if (name === null) return;
  name = name.trim();
  if (!name) { Toast.show('Название не может быть пустым', 'warning'); return; }
  var notes = prompt('Примечание:', org.notes || '');
  if (notes === null) return;
  DustState.updateOrg(id, { name: name, notes: notes.trim() });
  Toast.show('Организация обновлена', 'success');
  _dustRenderOrgList();
  _dustRefreshOrgSelects();
}

function _dustDeleteOrg(id) {
  var org    = DustState.orgById(id);
  var vCount = DustState.vehiclesOfOrg(id).length;
  var msg    = 'Удалить организацию "' + ((org || {}).name || id) + '"?' +
    (vCount > 0 ? '\nВместе с ней будет удалено ' + vCount + ' машин(а/ы).' : '');
  if (!confirm(msg)) return;
  DustState.deleteOrg(id);
  Toast.show('Организация удалена', 'info');
  _dustRenderOrgList();
  _dustRenderVehicleList();
  _dustRefreshOrgSelects();
}

function _dustAddVehicle() {
  var orgId    = ((document.getElementById('dust-veh-org')    || {}).value || '').trim();
  var name     = ((document.getElementById('dust-veh-name')   || {}).value || '').trim();
  var plate    = ((document.getElementById('dust-veh-plate')  || {}).value || '').trim();
  var cap      = ((document.getElementById('dust-veh-cap')    || {}).value || '').trim();
  var nozzleId = ((document.getElementById('dust-veh-nozzle') || {}).value || '');
  var notes    = ((document.getElementById('dust-veh-notes')  || {}).value || '').trim();
  if (!orgId) { Toast.show('Выберите организацию', 'warning');   return; }
  if (!name)  { Toast.show('Введите название машины', 'warning'); return; }
  DustState.addVehicle({ orgId: orgId, name: name, plateNumber: plate, capacity: cap !== '' ? parseFloat(cap) : null, defaultNozzleId: nozzleId || '', notes: notes });
  document.getElementById('dust-veh-name').value   = '';
  document.getElementById('dust-veh-plate').value  = '';
  document.getElementById('dust-veh-cap').value    = '';
  document.getElementById('dust-veh-nozzle').value = '';
  document.getElementById('dust-veh-notes').value  = '';
  Toast.show('Машина добавлена', 'success');
  _dustRenderVehicleList();
}

function _dustDeleteVehicle(id) {
  var v = DustState.vehicleById(id);
  if (!confirm('Удалить машину "' + ((v || {}).name || id) + '"?')) return;
  DustState.deleteVehicle(id);
  Toast.show('Машина удалена', 'info');
  _dustRenderVehicleList();
}

function _dustRefreshOrgSelects() {
  var vf = document.getElementById('dust-vehicle-filter-org');
  if (vf) { vf.innerHTML = _dustOrgOpts(_dustVehicleFilter, 'Все организации'); }
  var vo = document.getElementById('dust-veh-org');
  if (vo) { vo.innerHTML = _dustOrgOpts(''); }
}

// ── Гусаки ───────────────────────────────────────────────────

function _dustRenderNozzles() {
  var el = document.getElementById('dust-panel-nozzles');
  if (!el) return;

  var hasDew = typeof DewateringState !== 'undefined';

  el.innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 320px;gap:14px;align-items:start">' +
      // LEFT: nozzle cards
      '<div>' +
        '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3);margin-bottom:8px">Гусаки (точки пылеподавления)</div>' +
        '<div id="dust-nozzle-list"></div>' +
      '</div>' +
      // RIGHT: add form
      '<div>' +
        '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3);margin-bottom:8px">Добавить гусак</div>' +
        '<div class="card" style="padding:14px">' +
          _dustFld('Название', 'text', 'dust-nzl-name', '', 'Гусак №1') +
          '<div class="form-group"><label class="form-label">Тип источника</label>' +
            '<input type="text" class="form-control" value="Зумпф" readonly style="color:var(--txt-3);background:var(--bg-1)">' +
          '</div>' +
          '<div class="form-group"><label class="form-label">Зумпф-источник</label>' +
            '<select id="dust-nzl-sump" class="form-control">' + _dustSumpOpts('') + '</select>' +
          '</div>' +
          _dustFld('Местоположение', 'text', 'dust-nzl-loc', '', 'Горизонт -50м') +
          _dustFld('Примечание', 'text', 'dust-nzl-notes', '', '') +
          '<button class="btn btn-sm" style="background:var(--gold);color:#000;margin-top:4px" onclick="_dustAddNozzle()">Добавить гусак</button>' +
          (!hasDew ? '<div style="margin-top:10px;font-size:10px;color:var(--txt-3)">Модуль водоотлива не загружен — зумпфы недоступны</div>' : '') +
        '</div>' +
      '</div>' +
    '</div>';

  _dustRenderNozzleList();
}

function _dustRenderNozzleList() {
  var el = document.getElementById('dust-nozzle-list');
  if (!el) return;
  if (!DustState.nozzles.length) {
    el.innerHTML = '<div class="card" style="padding:20px;text-align:center;color:var(--txt-3);font-size:12px">Гусаки не добавлены — заполните форму справа</div>';
    return;
  }
  el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">' +
    DustState.nozzles.map(function(nzl) {
      var sumpName = 'не задан';
      if (nzl.sourceType === 'sump' && nzl.sourceId && typeof DewateringState !== 'undefined') {
        var sump = DewateringState.sumpById(nzl.sourceId);
        if (sump) sumpName = sump.name;
      }
      var volMonth = _dustNozzleVolumeMonth(nzl.id);
      return '<div class="card" style="padding:12px">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px">' +
          '<div style="font-weight:600;color:var(--txt-1);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">💧 ' + escHTML(nzl.name) + '</div>' +
          '<div style="display:flex;gap:4px;flex-shrink:0;margin-left:6px">' +
            '<button class="btn btn-sm btn-outline" style="font-size:10px;padding:2px 5px" onclick="_dustEditNozzlePrompt(\'' + nzl.id + '\')">✎</button>' +
            '<button class="btn btn-sm" style="font-size:10px;padding:2px 5px;background:rgba(248,113,113,.1);color:var(--bad);border:1px solid rgba(248,113,113,.2)" onclick="_dustDeleteNozzle(\'' + nzl.id + '\')">✕</button>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--txt-3);margin-bottom:4px">Источник: <span style="color:var(--txt-2)">' + escHTML(sumpName) + '</span></div>' +
        (nzl.location ? '<div style="font-size:11px;color:var(--txt-3);margin-bottom:4px">Место: <span style="color:var(--txt-2)">' + escHTML(nzl.location) + '</span></div>' : '') +
        '<div style="font-size:11px;color:var(--txt-3)">За месяц: <b style="color:' + (volMonth > 0 ? 'var(--ok)' : 'var(--txt-3)') + '">' + volMonth.toFixed(1) + ' м³</b></div>' +
        (nzl.notes ? '<div style="font-size:10px;color:var(--txt-3);margin-top:4px">' + escHTML(nzl.notes) + '</div>' : '') +
      '</div>';
    }).join('') + '</div>';
}

function _dustAddNozzle() {
  var name   = ((document.getElementById('dust-nzl-name')  || {}).value || '').trim();
  var sumpId = ((document.getElementById('dust-nzl-sump')  || {}).value || '').trim();
  var loc    = ((document.getElementById('dust-nzl-loc')   || {}).value || '').trim();
  var notes  = ((document.getElementById('dust-nzl-notes') || {}).value || '').trim();
  if (!name) { Toast.show('Введите название гусака', 'warning'); return; }
  DustState.addNozzle({ name: name, sourceType: 'sump', sourceId: sumpId || null, location: loc, notes: notes });
  document.getElementById('dust-nzl-name').value  = '';
  document.getElementById('dust-nzl-loc').value   = '';
  document.getElementById('dust-nzl-notes').value = '';
  Toast.show('Гусак добавлен', 'success');
  _dustRenderNozzleList();
}

function _dustEditNozzlePrompt(id) {
  var nzl = DustState.nozzleById(id);
  if (!nzl) return;
  var name = prompt('Название:', nzl.name);
  if (name === null) return;
  name = name.trim();
  if (!name) { Toast.show('Название не может быть пустым', 'warning'); return; }
  var loc   = prompt('Местоположение:', nzl.location || '');
  if (loc === null) return;
  var notes = prompt('Примечание:', nzl.notes || '');
  if (notes === null) return;
  DustState.updateNozzle(id, { name: name, location: loc.trim(), notes: notes.trim() });
  Toast.show('Гусак обновлён', 'success');
  _dustRenderNozzleList();
}

function _dustDeleteNozzle(id) {
  var nzl = DustState.nozzleById(id);
  if (!confirm('Удалить гусак "' + ((nzl || {}).name || id) + '"?')) return;
  DustState.deleteNozzle(id);
  Toast.show('Гусак удалён', 'info');
  _dustRenderNozzleList();
}

// ── Аналитика ─────────────────────────────────────────────────

function _dustRenderAnalytics() {
  var el = document.getElementById('dust-panel-analytics');
  if (!el) return;

  el.innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
      '<div class="card" style="padding:14px"><div class="card-title">Объём за последние 30 дней</div><div id="dust-ch-trend"></div></div>' +
      '<div class="card" style="padding:14px"><div class="card-title">По организациям (всё время)</div><div id="dust-ch-orgs"></div></div>' +
      '<div class="card" style="padding:14px"><div class="card-title">По гусакам (всё время)</div><div id="dust-ch-nozzles"></div></div>' +
      '<div class="card" style="padding:14px"><div class="card-title">Сравнение по месяцам (3 мес.)</div><div id="dust-ch-months"></div></div>' +
    '</div>';

  _dustChartTrend();
  _dustChartOrgs();
  _dustChartNozzles();
  _dustChartMonths();
}

function _dustChartTrend() {
  var el = document.getElementById('dust-ch-trend');
  if (!el) return;
  var days = [];
  for (var i = 29; i >= 0; i--) {
    var d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  var data = days.map(function(day) {
    var vol = DustState.logs
      .filter(function(l) { return l.date === day; })
      .reduce(function(a, l) { return a + _dustComputeVolume(l); }, 0);
    return { day: day, vol: vol };
  });

  var maxV = Math.max.apply(null, data.map(function(d) { return d.vol; })) || 1;
  var W = 360, H = 110, PL = 38, PR = 8, PT = 8, PB = 22;
  var cW = W - PL - PR, cH = H - PT - PB, n = data.length;
  var bW = Math.max(1, Math.floor(cW / n) - 1);

  var bars = data.map(function(d, i) {
    if (!d.vol) return '';
    var bH = Math.max(2, (d.vol / maxV) * cH), x = PL + i * (cW / n) + 1, y = PT + cH - bH;
    return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bW + '" height="' + bH.toFixed(1) + '"' +
      ' fill="' + (i === n - 1 ? 'var(--gold)' : 'rgba(34,211,238,.65)') + '" opacity=".85" rx="1">' +
      '<title>' + d.day + ': ' + d.vol.toFixed(1) + ' м³</title></rect>';
  }).join('');

  var yLines = [0, maxV / 2, maxV].map(function(v) {
    var y = (PT + cH - (v / maxV) * cH).toFixed(1);
    return '<line x1="' + PL + '" y1="' + y + '" x2="' + (W - PR) + '" y2="' + y + '" stroke="rgba(255,255,255,.05)" stroke-width="1"/>' +
      '<text x="' + (PL - 3) + '" y="' + (parseFloat(y) + 3) + '" fill="var(--txt-3)" font-size="8" text-anchor="end">' + Math.round(v) + '</text>';
  }).join('');

  var xLbls = data.filter(function(_, i) { return i % 7 === 0 || i === n - 1; }).map(function(d) {
    var i = days.indexOf(d.day), x = PL + i * (cW / n) + bW / 2;
    return '<text x="' + x.toFixed(1) + '" y="' + (H - 4) + '" fill="var(--txt-3)" font-size="7" text-anchor="middle">' + d.day.slice(5) + '</text>';
  }).join('');

  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;display:block">' + yLines + bars + xLbls + '</svg>' +
    (data.every(function(d) { return d.vol === 0; }) ? '<p style="color:var(--txt-3);font-size:11px;text-align:center;margin:4px 0">Нет данных за последние 30 дней</p>' : '');
}

function _dustChartOrgs() {
  var el = document.getElementById('dust-ch-orgs');
  if (!el) return;
  if (!DustState.orgs.length) {
    el.innerHTML = '<p style="color:var(--txt-3);font-size:11px;text-align:center;padding:20px">Нет организаций</p>';
    return;
  }
  var byOrg = {};
  DustState.logs.forEach(function(l) {
    byOrg[l.orgId] = (byOrg[l.orgId] || 0) + _dustComputeVolume(l);
  });
  var total = Object.keys(byOrg).reduce(function(a, k) { return a + byOrg[k]; }, 0);
  if (!total) {
    el.innerHTML = '<p style="color:var(--txt-3);font-size:11px;text-align:center;padding:20px">Нет данных</p>';
    return;
  }
  var clrs = ['var(--gold)', 'var(--ok)', 'var(--warn)', 'var(--bad)', '#bc8cff', '#58a6ff', 'rgba(34,211,238,.8)'];
  var entries = DustState.orgs.filter(function(o) { return byOrg[o.id]; }).map(function(o, i) {
    return { name: o.name, vol: byOrg[o.id] || 0, clr: clrs[i % clrs.length] };
  }).sort(function(a, b) { return b.vol - a.vol; });

  el.innerHTML = entries.map(function(e) {
    var pct = Math.round(e.vol / total * 100);
    return '<div style="margin-bottom:9px">' +
      '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">' +
        '<span style="color:var(--txt-2)">' + escHTML(e.name) + '</span>' +
        '<span style="color:' + e.clr + ';font-weight:600">' + e.vol.toFixed(0) + ' м³ <span style="color:var(--txt-3);font-weight:400">(' + pct + '%)</span></span>' +
      '</div>' +
      '<div style="background:var(--bg-1);border-radius:3px;height:5px;overflow:hidden">' +
        '<div style="height:100%;width:' + pct + '%;background:' + e.clr + ';border-radius:3px"></div>' +
      '</div></div>';
  }).join('') + '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line);font-size:11px;color:var(--txt-3)">Всего: <b style="color:var(--txt-1)">' + total.toFixed(0) + ' м³</b></div>';
}

function _dustChartNozzles() {
  var el = document.getElementById('dust-ch-nozzles');
  if (!el) return;
  if (!DustState.nozzles.length) {
    el.innerHTML = '<p style="color:var(--txt-3);font-size:11px;text-align:center;padding:20px">Нет гусаков</p>';
    return;
  }
  var byNzl = {};
  DustState.logs.forEach(function(l) {
    byNzl[l.nozzleId] = (byNzl[l.nozzleId] || 0) + _dustComputeVolume(l);
  });
  var nozzles = DustState.nozzles.slice().sort(function(a, b) { return (byNzl[b.id] || 0) - (byNzl[a.id] || 0); });
  var maxV = byNzl[nozzles[0].id] || 1;
  if (!maxV) {
    el.innerHTML = '<p style="color:var(--txt-3);font-size:11px;text-align:center;padding:20px">Нет данных</p>';
    return;
  }
  el.innerHTML = nozzles.map(function(n) {
    var vol = byNzl[n.id] || 0;
    var pct = Math.round(vol / maxV * 100);
    return '<div style="margin-bottom:10px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;margin-bottom:3px">' +
        '<span style="color:var(--txt-1)">💧 ' + escHTML(n.name) + '</span>' +
        '<span style="color:var(--txt-2)">' + vol.toFixed(0) + ' м³</span>' +
      '</div>' +
      '<div style="background:var(--bg-1);border-radius:3px;height:6px;overflow:hidden">' +
        '<div style="height:100%;width:' + pct + '%;background:rgba(34,211,238,.7);border-radius:3px"></div>' +
      '</div></div>';
  }).join('');
}

function _dustChartMonths() {
  var el = document.getElementById('dust-ch-months');
  if (!el) return;
  if (!DustState.nozzles.length) {
    el.innerHTML = '<p style="color:var(--txt-3);font-size:11px;text-align:center;padding:20px">Нет гусаков</p>';
    return;
  }
  var now = new Date();
  var ruM = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  var months = [];
  for (var i = 2; i >= 0; i--) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: d.toISOString().slice(0, 7), label: ruM[d.getMonth()] });
  }
  var clrs = ['var(--gold)', 'var(--ok)', 'var(--warn)', 'var(--bad)', '#bc8cff', 'rgba(34,211,238,.8)'];
  var rows = DustState.nozzles.map(function(nzl, ni) {
    var vols = months.map(function(m) {
      return DustState.logs
        .filter(function(l) { return l.nozzleId === nzl.id && l.date.slice(0, 7) === m.key; })
        .reduce(function(a, l) { return a + _dustComputeVolume(l); }, 0);
    });
    return { nzl: nzl, vols: vols, clr: clrs[ni % clrs.length] };
  });
  var maxV = 0;
  rows.forEach(function(r) { r.vols.forEach(function(v) { if (v > maxV) maxV = v; }); });
  maxV = maxV || 1;
  el.innerHTML = rows.map(function(r) {
    return '<div style="margin-bottom:14px">' +
      '<div style="font-size:11px;color:var(--txt-1);font-weight:600;margin-bottom:6px">💧 ' + escHTML(r.nzl.name) + '</div>' +
      '<div style="display:flex;gap:6px;align-items:flex-end;height:48px">' +
      r.vols.map(function(v, i) {
        var h = v > 0 ? Math.max(4, Math.round(v / maxV * 42)) : 0;
        return '<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1">' +
          '<div style="font-size:9px;color:var(--txt-3)">' + (v > 0 ? v.toFixed(0) : '') + '</div>' +
          '<div style="width:100%;background:' + r.clr + ';height:' + h + 'px;border-radius:2px 2px 0 0;opacity:.8"></div>' +
          '<div style="font-size:9px;color:var(--txt-3)">' + months[i].label + '</div>' +
        '</div>';
      }).join('') + '</div></div>';
  }).join('');
}
