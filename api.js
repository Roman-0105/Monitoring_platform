/**
 * api.js — единственный модуль для общения с Supabase.
 *
 * Упрощённая структура (4 таблицы):
 *   points   — каждая строка = один замер в одной точке
 *   ditches  — каждая строка = один замер одной канавы
 *   workers  — сотрудники
 *   schemes  — схемы карьера (изображения)
 *
 * История точки  = SELECT * FROM points WHERE point_number = X
 * История канавы = SELECT * FROM ditches WHERE ditch_name  = X
 */

// ── Маппинг dewatering (sumps, elevations, pumps, events, destinations, readings, water levels) ──

function dewSumpToRow(s) {
  return { id: s.id, name: s.name || '', quarry: s.quarry || '', notes: s.notes || '' };
}
function rowToDewSump(r) {
  return { id: r.id, name: r.name || '', quarry: r.quarry || '', notes: r.notes || '' };
}

function dewElevToRow(h) {
  return { id: h.id, sump_id: h.sumpId, date: h.date, elevation: h.elevation != null ? Number(h.elevation) : null, notes: h.notes || '' };
}
function rowToDewElev(r) {
  return { id: r.id, sumpId: r.sump_id, date: r.date, elevation: r.elevation != null ? Number(r.elevation) : null, notes: r.notes || '' };
}

function dewPumpToRow(p) {
  return {
    id: p.id, sump_id: p.sumpId, name: p.name || '', model: p.model || '',
    serial_number: p.serialNumber || '', inventory_number: p.inventoryNumber || '',
    quarry: p.quarry || '', capacity: p.capacity != null ? Number(p.capacity) : null,
    head: p.head != null ? Number(p.head) : null, type: p.type || '',
    status: p.status || 'off', install_date: p.installDate || null,
    notes: p.notes || '', count_in_volume: p.countInVolume !== false
  };
}
function rowToDewPump(r) {
  return {
    id: r.id, sumpId: r.sump_id, name: r.name || '', model: r.model || '',
    serialNumber: r.serial_number || '', inventoryNumber: r.inventory_number || '',
    quarry: r.quarry || '', capacity: r.capacity != null ? Number(r.capacity) : null,
    head: r.head != null ? Number(r.head) : null, type: r.type || '',
    status: r.status || 'off', installDate: r.install_date || null,
    notes: r.notes || '', countInVolume: r.count_in_volume !== false
  };
}

function dewEvtToRow(e) {
  return {
    id: e.id, sump_id: e.sumpId, date: e.date, type: e.type || '',
    removed_pump_id: e.removedPumpId || null, installed_pump_id: e.installedPumpId || null,
    reason: e.reason || '', performed_by: e.performedBy || '', notes: e.notes || ''
  };
}
function rowToDewEvt(r) {
  return {
    id: r.id, sumpId: r.sump_id, date: r.date, type: r.type || '',
    removedPumpId: r.removed_pump_id || null, installedPumpId: r.installed_pump_id || null,
    reason: r.reason || '', performedBy: r.performed_by || '', notes: r.notes || ''
  };
}

function dewDestToRow(d) {
  return { id: d.id, name: d.name || '', type: d.type || '', target_sump_id: d.targetSumpId || null };
}
function rowToDewDest(r) {
  return { id: r.id, name: r.name || '', type: r.type || '', targetSumpId: r.target_sump_id || null };
}

function dewReadingToRow(r) {
  return {
    id: r.id, pump_id: r.pumpId, date: r.date,
    reading: r.reading != null ? Number(r.reading) : null,
    is_reset: !!r.isReset, is_stopped: !!r.isStopped,
    reset_start_value: r.resetStartValue != null ? Number(r.resetStartValue) : null,
    downtime_reason: r.downtimeReason || '',
    hours_worked: r.hoursWorked != null ? Number(r.hoursWorked) : null,
    distributions: r.distributions || [],
    is_manual_volume: !!r.isManualVolume,
    manual_volume: r.manualVolume != null ? Number(r.manualVolume) : null,
    notes: r.notes || ''
  };
}
function rowToDewReading(r) {
  return {
    id: r.id, pumpId: r.pump_id, date: r.date,
    reading: r.reading != null ? Number(r.reading) : null,
    isReset: !!r.is_reset, isStopped: !!r.is_stopped,
    resetStartValue: r.reset_start_value != null ? Number(r.reset_start_value) : null,
    downtimeReason: r.downtime_reason || '',
    hoursWorked: r.hours_worked != null ? Number(r.hours_worked) : null,
    distributions: Array.isArray(r.distributions) ? r.distributions : [],
    isManualVolume: !!r.is_manual_volume,
    manualVolume: r.manual_volume != null ? Number(r.manual_volume) : null,
    notes: r.notes || ''
  };
}

function dewLevelToRow(w) {
  return {
    id: w.id, sump_id: w.sumpId, date: w.date, time: w.time || '',
    elevation: w.elevation != null ? Number(w.elevation) : null,
    measured_by: w.measuredBy || '', notes: w.notes || ''
  };
}
function rowToDewLevel(r) {
  return {
    id: r.id, sumpId: r.sump_id, date: r.date, time: r.time || '',
    elevation: r.elevation != null ? Number(r.elevation) : null,
    measuredBy: r.measured_by || '', notes: r.notes || ''
  };
}

// ── Маппинг dust suppression (orgs, vehicles, nozzles, logs) ──

function dustOrgToRow(o) { return { id: o.id, name: o.name || '', notes: o.notes || '' }; }
function rowToDustOrg(r) { return { id: r.id, name: r.name || '', notes: r.notes || '' }; }

function dustVehToRow(v) {
  return { id: v.id, org_id: v.orgId, name: v.name || '', plate_number: v.plateNumber || '', capacity: v.capacity != null ? Number(v.capacity) : null, notes: v.notes || '' };
}
function rowToDustVeh(r) {
  return { id: r.id, orgId: r.org_id, name: r.name || '', plateNumber: r.plate_number || '', capacity: r.capacity != null ? Number(r.capacity) : null, notes: r.notes || '' };
}

function dustNozzleToRow(n) {
  return { id: n.id, name: n.name || '', source_type: n.sourceType || 'sump', source_id: n.sourceId || null, location: n.location || '', notes: n.notes || '' };
}
function rowToDustNozzle(r) {
  return { id: r.id, name: r.name || '', sourceType: r.source_type || 'sump', sourceId: r.source_id || null, location: r.location || '', notes: r.notes || '' };
}

function dustLogToRow(l) {
  return {
    id: l.id, date: l.date, org_id: l.orgId, vehicle_id: l.vehicleId,
    nozzle_id: l.nozzleId, trips: l.trips != null ? Number(l.trips) : null,
    total_volume: l.totalVolume != null ? Number(l.totalVolume) : null,
    is_manual_volume: !!l.isManualVolume,
    manual_volume: l.manualVolume != null ? Number(l.manualVolume) : null,
    notes: l.notes || ''
  };
}
function rowToDustLog(r) {
  return {
    id: r.id, date: r.date, orgId: r.org_id, vehicleId: r.vehicle_id,
    nozzleId: r.nozzle_id, trips: r.trips != null ? Number(r.trips) : null,
    totalVolume: r.total_volume != null ? Number(r.total_volume) : null,
    isManualVolume: !!r.is_manual_volume,
    manualVolume: r.manual_volume != null ? Number(r.manual_volume) : null,
    notes: r.notes || ''
  };
}

var Api = (function() {

  var _client = null;

  function client() {
    if (_client) return _client;
    if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
      throw new Error('Supabase SDK не загружен');
    }
    var cfg = window.APP_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_KEY) {
      throw new Error('SUPABASE_URL / SUPABASE_KEY не заданы в APP_CONFIG');
    }
    _client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
    return _client;
  }

  // ── Маппинг points ────────────────────────────────────────

  function pointToRow(p) {
    return {
      id:              p.id,
      point_number:    p.pointNumber     || '',
      monitoring_date: p.monitoringDate  || null,
      worker:          p.worker          || '',
      lat:             p.lat             != null ? p.lat    : null,
      lon:             p.lon             != null ? p.lon    : null,
      x_local:         p.xLocal          != null ? p.xLocal : null,
      y_local:         p.yLocal          != null ? p.yLocal : null,
      status:          p.status          || 'Новая',
      intensity:       p.intensity       || '',
      flow_rate:       p.flowRate        != null ? p.flowRate : null,
      water_color:     p.waterColor      || '',
      wall:            p.wall            || '',
      domain:          p.domain          || '',
      measure_method:  p.measureMethod   || '',
      horizon:         p.horizon         || '',
      comment:         p.comment         || '',
      photos:          Array.isArray(p.photoUrls) ? p.photoUrls : [],
      quarry:          p.quarry          || (window.AppState && AppState.activeQuarry) || '',
      created_at:      p.createdAt       || new Date().toISOString(),
    };
  }

  function rowToPoint(r) {
    return {
      id:             r.id,
      pointNumber:    r.point_number,
      monitoringDate: r.monitoring_date || (r.created_at ? r.created_at.slice(0, 10) : null),
      worker:         r.worker,
      lat:            r.lat,
      lon:            r.lon,
      xLocal:         r.x_local,
      yLocal:         r.y_local,
      status:         r.status,
      intensity:      r.intensity,
      flowRate:       r.flow_rate,
      waterColor:     r.water_color,
      wall:           r.wall,
      domain:         r.domain,
      measureMethod:  r.measure_method,
      horizon:        r.horizon,
      comment:        r.comment,
      photoUrls:      r.photos || [],
      quarry:         r.quarry || '',
      createdAt:      r.created_at,
      // Поля совместимости (offline queue)
      syncStatus:     'synced',
      syncedAt:       r.created_at,
    };
  }

  // ── Маппинг workers ───────────────────────────────────────

  function workerToRow(w) {
    return {
      id:         w.id,
      name:       w.name,
      active:     w.active !== false,
      created_at: w.createdAt || new Date().toISOString(),
    };
  }

  function rowToWorker(r) {
    return { id: r.id, name: r.name, active: r.active, createdAt: r.created_at };
  }

  // ── Маппинг ditches ───────────────────────────────────────

  function ditchToRow(d) {
    return {
      id:              d.id,
      point_number:    d.pointNumber    || '',
      ditch_name:      d.ditchName      || '',
      quarry:          d.quarry         || (window.AppState && AppState.activeQuarry) || '',
      monitoring_date: d.monitoringDate || null,
      worker:          d.worker         || '',
      lat:             d.lat            != null ? d.lat    : null,
      lon:             d.lon            != null ? d.lon    : null,
      x_local:         d.xLocal         != null ? d.xLocal : null,
      y_local:         d.yLocal         != null ? d.yLocal : null,
      status:          d.status         || 'Активная',
      width:           d.width          != null ? d.width    : null,
      vel_method:      d.velMethod      || 'single',
      velocity:        d.velocity       != null ? d.velocity : null,
      float_l:         d.floatL         != null ? d.floatL   : null,
      float_t:         d.floatT         != null ? d.floatT   : null,
      float_k:         d.floatK         != null ? d.floatK   : null,
      dist_mode:       d.distMode       || 'u',
      n_points:        d.nPoints        != null ? d.nPoints  : null,
      depths:          Array.isArray(d.depths) ? d.depths : [],
      dists:           Array.isArray(d.dists)  ? d.dists  : [],
      area:            d.area           != null ? d.area    : null,
      flow_m3h:        d.flowM3h        != null ? d.flowM3h : null,
      comment:         d.comment        || '',
      photos:          Array.isArray(d.photoUrls) ? d.photoUrls : [],
      created_at:      d.createdAt      || new Date().toISOString(),
    };
  }

  function rowToDitch(r) {
    return {
      id:             r.id,
      pointNumber:    r.point_number,
      ditchName:      r.ditch_name,
      quarry:         r.quarry || '',
      monitoringDate: r.monitoring_date,
      worker:         r.worker,
      lat:            r.lat,
      lon:            r.lon,
      xLocal:         r.x_local,
      yLocal:         r.y_local,
      status:         r.status,
      width:          r.width,
      velMethod:      r.vel_method,
      velocity:       r.velocity,
      floatL:         r.float_l,
      floatT:         r.float_t,
      floatK:         r.float_k,
      distMode:       r.dist_mode,
      nPoints:        r.n_points,
      depths:         r.depths  || [],
      dists:          r.dists   || [],
      area:           r.area,
      flowM3h:        r.flow_m3h,
      comment:        r.comment,
      photoUrls:      r.photos  || [],
      createdAt:      r.created_at,
    };
  }

  // ── base64 → Blob ─────────────────────────────────────────

  function base64ToBlob(base64, mimeType) {
    var str = atob(base64);
    var arr = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
    return new Blob([arr], { type: mimeType || 'image/jpeg' });
  }

  // ── Points CRUD ───────────────────────────────────────────

  async function getPoints() {
    var quarry = (window.AppState && AppState.activeQuarry) || '';
    var { data, error } = await client().from('points').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    var all = (data || []).map(rowToPoint);
    if (!quarry) return all;
    return all.filter(function(p) { return (p.quarry || quarry) === quarry; });
  }

  async function getPoint(id) {
    var { data, error } = await client()
      .from('points').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToPoint(data) : null;
  }

  async function createPoint(point) {
    var { error } = await client().from('points').insert(pointToRow(point));
    if (error) throw new Error(error.message);
  }

  async function updatePoint(point) {
    var { error } = await client()
      .from('points').update(pointToRow(point)).eq('id', point.id);
    if (error) throw new Error(error.message);
  }

  async function deletePoint(id) {
    var { error } = await client().from('points').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // История точки = все замеры по point_number
  async function getHistory(pointNumber) {
    var { data, error } = await client()
      .from('points').select('*')
      .eq('point_number', pointNumber)
      .order('monitoring_date', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(function(r) {
      return {
        pointNumber:    r.point_number,
        monitoringDate: r.monitoring_date,
        flowRate:       r.flow_rate,
        flowRateM3h:    r.flow_rate != null ? Math.round(r.flow_rate * 3.6 * 100) / 100 : null,
        status:         r.status,
        intensity:      r.intensity,
        measureMethod:  r.measure_method,
        worker:         r.worker,
        recordedAt:     r.created_at,
      };
    });
  }

  // Фото точки = photoUrls из всех замеров по point_number
  async function getPhotos(pointNumber) {
    var { data, error } = await client()
      .from('points').select('photos, monitoring_date, flow_rate')
      .eq('point_number', pointNumber)
      .order('monitoring_date', { ascending: false });
    if (error) throw new Error(error.message);
    var photos = [];
    (data || []).forEach(function(r) {
      (r.photos || []).forEach(function(url) {
        photos.push({ photoUrl: url, monitoringDate: r.monitoring_date, flowRate: r.flow_rate });
      });
    });
    return photos;
  }

  // ── Workers CRUD ──────────────────────────────────────────

  async function getWorkers() {
    var { data, error } = await client()
      .from('workers').select('*').eq('active', true).order('name');
    if (error) throw new Error(error.message);
    return (data || []).map(rowToWorker);
  }

  async function saveWorker(worker) {
    var { error } = await client().from('workers').upsert(workerToRow(worker));
    if (error) throw new Error(error.message);
  }

  async function deleteWorker(id) {
    var { error } = await client().from('workers').update({ active: false }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Schemes ───────────────────────────────────────────────

  async function getSchemes() {
    var quarry = (window.AppState && AppState.activeQuarry) || '';
    var { data, error } = await client().from('schemes').select('*')
      .order('week_key',    { ascending: false })
      .order('uploaded_at', { ascending: false });
    if (error) throw new Error(error.message);

    // Client-side quarry filter: empty/null quarry treated as belonging to active quarry
    var all = data || [];
    if (quarry) {
      all = all.filter(function(r) { return (r.quarry || quarry) === quarry; });
    }

    // Deduplicate: keep only the newest entry per week_key
    var seen = {};
    var rows = all.filter(function(r) {
      if (seen[r.week_key]) return false;
      seen[r.week_key] = true;
      return true;
    });

    return rows.map(function(r) {
      var urlResult = client().storage.from('schemes').getPublicUrl(r.storage_path);
      var publicUrl = urlResult.data ? urlResult.data.publicUrl : '';
      return {
        weekKey:     r.week_key,
        driveUrl:    publicUrl,
        driveFileId: r.storage_path,
        uploadedAt:  r.uploaded_at || '',
        uploadedBy:  r.uploaded_by || '',
      };
    });
  }

  async function getSchemesByQuarry(quarryName) {
    var { data, error } = await client().from('schemes').select('*')
      .order('week_key',    { ascending: false })
      .order('uploaded_at', { ascending: false });
    if (error) throw new Error(error.message);
    var all = (data || []);
    if (quarryName) {
      all = all.filter(function(r) { return (r.quarry || quarryName) === quarryName; });
    }
    var seen = {};
    var rows = all.filter(function(r) {
      if (seen[r.week_key]) return false;
      seen[r.week_key] = true;
      return true;
    });
    return rows.map(function(r) {
      var urlResult = client().storage.from('schemes').getPublicUrl(r.storage_path);
      var publicUrl = urlResult.data ? urlResult.data.publicUrl : '';
      return {
        weekKey:    r.week_key,
        driveUrl:   publicUrl,
        storagePath: r.storage_path,
        uploadedAt: r.uploaded_at || '',
        quarry:     r.quarry || '',
      };
    });
  }

  async function uploadScheme(params) {
    if (!params.base64 || params.base64.length < 100) {
      throw new Error('Схема не сжалась корректно — пустые данные изображения');
    }

    var _mime = params.mimeType || 'image/jpeg';
    var ext  = _mime === 'image/svg+xml' ? 'svg' : (_mime.split('/')[1] || 'jpg');
    var path = params.weekKey + '_' + Date.now() + '.' + ext;
    var blob = base64ToBlob(params.base64, params.mimeType);

    if (blob.size < 512) {
      throw new Error('Файл схемы пустой (' + blob.size + ' байт) — проверьте исходный файл');
    }

    // Получаем текущий storage_path чтобы удалить старый файл
    var _uploadQuarry = params.quarry
      || (window.AppState && AppState.activeQuarry)
      || (window.AppState && AppState.quarries && AppState.quarries[0] && AppState.quarries[0].name)
      || '';
    var { data: existing } = await client()
      .from('schemes').select('storage_path')
      .eq('week_key', params.weekKey)
      .eq('quarry', _uploadQuarry)
      .maybeSingle();

    if (existing && existing.storage_path && existing.storage_path !== path) {
      await client().storage.from('schemes').remove([existing.storage_path]).catch(function() {});
    }

    var { error: uploadError } = await client().storage
      .from('schemes').upload(path, blob, { upsert: false, contentType: params.mimeType });
    if (uploadError) throw new Error('Storage: ' + uploadError.message + ' (status ' + (uploadError.statusCode || uploadError.status || '?') + ')');

    // Delete old DB row if one existed, then insert fresh (avoids needing a unique constraint)
    if (existing) {
      await client().from('schemes')
        .delete()
        .eq('week_key', params.weekKey)
        .eq('quarry', _uploadQuarry);
    }
    var { error: dbError } = await client().from('schemes').insert({
      week_key:     params.weekKey,
      storage_path: path,
      uploaded_at:  new Date().toISOString(),
      uploaded_by:  params.uploadedBy || '',
      quarry:       _uploadQuarry,
    });
    if (dbError) throw new Error(dbError.message);
  }

  // ── Photos (Supabase Storage) ─────────────────────────────

  async function uploadPhotoConfirmed(pointId, fileName, base64, mimeType) {
    var blob = base64ToBlob(base64, mimeType);
    var path = pointId + '/' + Date.now() + '_' + fileName;

    var { error: uploadError } = await client().storage
      .from('photos').upload(path, blob, { upsert: true, contentType: mimeType });
    if (uploadError) throw new Error(uploadError.message);

    var urlResult = client().storage.from('photos').getPublicUrl(path);
    var photoUrl  = urlResult.data ? urlResult.data.publicUrl : path;

    var { data: row, error: fetchError } = await client()
      .from('points').select('photos').eq('id', pointId).maybeSingle();
    if (fetchError) throw new Error(fetchError.message);

    var updated = [photoUrl].concat((row && row.photos) || []);

    var { error: updateError } = await client()
      .from('points').update({ photos: updated }).eq('id', pointId);
    if (updateError) throw new Error(updateError.message);

    return photoUrl;
  }

  async function deletePhoto(pointId, photoUrl) {
    var { data: row, error: fetchError } = await client()
      .from('points').select('photos').eq('id', pointId).maybeSingle();
    if (fetchError) throw new Error(fetchError.message);
    var remaining = ((row && row.photos) || []).filter(function(u) { return u !== photoUrl; });
    var { error } = await client()
      .from('points').update({ photos: remaining }).eq('id', pointId);
    if (error) throw new Error(error.message);
  }

  // ── Ditches CRUD ──────────────────────────────────────────

  async function getDitches(pointNumber) {
    var quarry = (window.AppState && AppState.activeQuarry) || '';
    var query = client().from('ditches').select('*').order('created_at', { ascending: false });
    if (pointNumber) query = query.eq('point_number', pointNumber);
    var { data, error } = await query;
    if (error) throw new Error(error.message);
    var all = (data || []).map(rowToDitch);
    if (!quarry) return { ditches: all };
    return { ditches: all.filter(function(d) { return (d.quarry || quarry) === quarry; }) };
  }

  async function getDitch(id) {
    var { data, error } = await client()
      .from('ditches').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return { ditch: data ? rowToDitch(data) : null };
  }

  async function createDitch(d) {
    var { error } = await client().from('ditches').insert(ditchToRow(d));
    if (error) throw new Error(error.message);
    return { status: 'created', id: d.id };
  }

  async function updateDitch(d) {
    var { error } = await client().from('ditches').update(ditchToRow(d)).eq('id', d.id);
    if (error) throw new Error(error.message);
    return { status: 'updated', id: d.id };
  }

  async function deleteDitch(id) {
    var { error } = await client().from('ditches').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { status: 'deleted', id: id };
  }

  // История канавы = все замеры по ditch_name
  async function getDitchHistory(ditchName) {
    var { data, error } = await client()
      .from('ditches').select('*')
      .eq('ditch_name', ditchName)
      .order('monitoring_date', { ascending: true });
    if (error) throw new Error(error.message);
    return { history: (data || []).map(function(r) {
      return {
        ditchName:      r.ditch_name,
        pointNumber:    r.point_number,
        monitoringDate: r.monitoring_date,
        worker:         r.worker,
        width:          r.width,
        area:           r.area,
        flowM3h:        r.flow_m3h,
        velMethod:      r.vel_method,
        recordedAt:     r.created_at,
      };
    })};
  }

  // ── Quarries ──────────────────────────────────────────────

  async function getQuarries() {
    var { data, error } = await client().from('quarries').select('*').order('id');
    if (error) throw new Error(error.message);
    return (data || []).map(function(r) {
      return {
        id:   r.id,
        name: r.name,
        xMin: r.x_min  != null ? Number(r.x_min)  : null,
        xMax: r.x_max  != null ? Number(r.x_max)  : null,
        yMin: r.y_min  != null ? Number(r.y_min)  : null,
        yMax: r.y_max  != null ? Number(r.y_max)  : null,
      };
    });
  }

  async function saveQuarryBounds(id, bounds) {
    var { error } = await client().from('quarries').update({
      x_min: bounds.xMin,
      x_max: bounds.xMax,
      y_min: bounds.yMin,
      y_max: bounds.yMax,
    }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Ping ─────────────────────────────────────────────────

  async function ping() {
    try {
      var { error } = await client().from('points').select('id').limit(1);
      return !error;
    } catch (_) { return false; }
  }

  // ── Маппинг wells ─────────────────────────────────────────

  function wellToRow(w) {
    return {
      id:               w.id,
      name:             w.name             || '',
      domain:           w.domain           || '',
      quarry:           w.quarry           || (window.AppState && AppState.activeQuarry) || '',
      quarry_section:   w.quarrySection    || '',
      status:           w.status           || 'Активная',
      depth:            w.depth            != null ? w.depth          : null,
      inclination:      w.inclination      != null ? w.inclination    : null,
      azimuth:          w.azimuth          != null ? w.azimuth        : null,
      drill_diameter:   w.drillDiameter    != null ? w.drillDiameter  : null,
      casing:           w.casing           || '',
      drill_date:       w.drillDate        || null,
      has_wellhead:     w.hasWellhead      === true,
      flow_after_drill: w.flowAfterDrill   != null ? w.flowAfterDrill : null,
      x_local:          w.xLocal           != null ? w.xLocal         : null,
      y_local:          w.yLocal           != null ? w.yLocal         : null,
      z_local:          w.zLocal           != null ? w.zLocal         : null,
      lat:              w.lat              != null ? w.lat            : null,
      lon:              w.lon              != null ? w.lon            : null,
      well_type:        w.wellType         || 'drainage',
      sensors:          Array.isArray(w.sensors) ? w.sensors : [],
      created_at:       w.createdAt        || new Date().toISOString(),
    };
  }

  function rowToWell(r) {
    return {
      id:             r.id,
      name:           r.name,
      domain:         r.domain,
      quarry:         r.quarry,
      quarrySection:  r.quarry_section,
      status:         r.status,
      depth:          r.depth,
      inclination:    r.inclination,
      azimuth:        r.azimuth,
      drillDiameter:  r.drill_diameter,
      casing:         r.casing,
      drillDate:      r.drill_date,
      hasWellhead:    r.has_wellhead,
      flowAfterDrill: r.flow_after_drill,
      xLocal:         r.x_local,
      yLocal:         r.y_local,
      zLocal:         r.z_local,
      lat:            r.lat,
      lon:            r.lon,
      wellType:       r.well_type || 'drainage',
      sensors:        Array.isArray(r.sensors) ? r.sensors : [],
      createdAt:      r.created_at,
    };
  }

  function measurementToRow(m) {
    return {
      id:               m.id,
      well_id:          m.wellId,
      measurement_date: m.measurementDate || null,
      flow_rate:        m.flowRate        != null ? m.flowRate : null,
      worker:           m.worker          || '',
      comment:          m.comment         || '',
      created_at:       m.createdAt       || new Date().toISOString(),
    };
  }

  function rowToMeasurement(r) {
    return {
      id:              r.id,
      wellId:          r.well_id,
      measurementDate: r.measurement_date,
      flowRate:        r.flow_rate,
      worker:          r.worker,
      comment:         r.comment,
      createdAt:       r.created_at,
    };
  }

  // ── Wells CRUD ────────────────────────────────────────────

  async function getWells() {
    var quarry = (window.AppState && AppState.activeQuarry) || '';
    var { data, error } = await client().from('wells').select('*').order('name', { ascending: true });
    if (error) throw new Error(error.message);
    var all = (data || []).map(rowToWell);
    if (!quarry) return all;
    // Wells without quarry set are treated as belonging to the active quarry (legacy data)
    return all.filter(function(w) {
      return (w.quarry || quarry) === quarry;
    });
  }

  async function getWell(id) {
    var { data, error } = await client()
      .from('wells').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToWell(data) : null;
  }

  async function createWell(w) {
    var { error } = await client().from('wells').insert(wellToRow(w));
    if (error) throw new Error(error.message);
    return { status: 'created', id: w.id };
  }

  async function updateWell(w) {
    var { error } = await client().from('wells').update(wellToRow(w)).eq('id', w.id);
    if (error) throw new Error(error.message);
    return { status: 'updated', id: w.id };
  }

  async function deleteWell(id) {
    var { error } = await client().from('wells').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { status: 'deleted', id: id };
  }

  // ── Well measurements CRUD ────────────────────────────────

  async function getWellMeasurements(wellId) {
    var { data, error } = await client()
      .from('well_measurements').select('*')
      .eq('well_id', wellId)
      .order('measurement_date', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(rowToMeasurement);
  }

  async function createMeasurement(m) {
    var { error } = await client().from('well_measurements').insert(measurementToRow(m));
    if (error) throw new Error(error.message);
    return { status: 'created', id: m.id };
  }

  async function updateMeasurement(m) {
    var { error } = await client()
      .from('well_measurements').update(measurementToRow(m)).eq('id', m.id);
    if (error) throw new Error(error.message);
    return { status: 'updated', id: m.id };
  }

  async function deleteMeasurement(id) {
    var { error } = await client().from('well_measurements').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { status: 'deleted', id: id };
  }

  return {
    client:              client,
    getQuarries:         getQuarries,
    saveQuarryBounds:    saveQuarryBounds,
    getPoints:           getPoints,
    getPoint:            getPoint,
    getWorkers:          getWorkers,
    getHistory:          getHistory,
    getPhotos:           getPhotos,
    getSchemes:          getSchemes,
    getSchemesByQuarry:  getSchemesByQuarry,
    getDitches:          getDitches,
    getDitch:            getDitch,
    getDitchHistory:     getDitchHistory,
    ping:                ping,

    post: function(payload) {
      if (!payload || !payload.action) return Promise.reject(new Error('Missing action'));
      if (payload.action === 'createDitch') return createDitch(payload.ditch);
      if (payload.action === 'updateDitch') return updateDitch(payload.ditch);
      if (payload.action === 'deleteDitch') return deleteDitch(payload.id);
      return Promise.reject(new Error('Unknown action: ' + payload.action));
    },
    createPoint:         createPoint,
    updatePoint:         updatePoint,
    deletePoint:         deletePoint,
    saveWorker:          saveWorker,
    deleteWorker:        deleteWorker,
    uploadPhotoConfirmed: uploadPhotoConfirmed,
    deletePhoto:         deletePhoto,
    uploadScheme:        uploadScheme,
    createDitch:         createDitch,
    updateDitch:         updateDitch,
    deleteDitch:         deleteDitch,
    getWells:            getWells,
    getWell:             getWell,
    createWell:          createWell,
    updateWell:          updateWell,
    deleteWell:          deleteWell,
    getWellMeasurements:  getWellMeasurements,
    createMeasurement:   createMeasurement,
    updateMeasurement:   updateMeasurement,
    deleteMeasurement:   deleteMeasurement,

    // ── Dewatering ────────────────────────────────────────────
    getDewSumps:        async function() { return client().from('dew_sumps').select('*').order('name'); },
    upsertDewSump:      async function(row) { return client().from('dew_sumps').upsert(row); },
    deleteDewSump:      async function(id) { return client().from('dew_sumps').delete().eq('id', id); },

    getDewElevations:   async function() { return client().from('dew_elevation_history').select('*').order('date', { ascending: false }); },
    upsertDewElev:      async function(row) { return client().from('dew_elevation_history').upsert(row); },
    deleteDewElev:      async function(id) { return client().from('dew_elevation_history').delete().eq('id', id); },

    getDewPumps:        async function() { return client().from('dew_pumps').select('*').order('name'); },
    upsertDewPump:      async function(row) { return client().from('dew_pumps').upsert(row); },
    deleteDewPump:      async function(id) { return client().from('dew_pumps').delete().eq('id', id); },

    getDewPumpEvents:   async function() { return client().from('dew_pump_events').select('*').order('date', { ascending: false }); },
    upsertDewPumpEvent: async function(row) { return client().from('dew_pump_events').upsert(row); },
    deleteDewPumpEvent: async function(id) { return client().from('dew_pump_events').delete().eq('id', id); },

    getDewDestinations: async function() { return client().from('dew_destinations').select('*').order('name'); },
    upsertDewDest:      async function(row) { return client().from('dew_destinations').upsert(row); },
    deleteDewDest:      async function(id) { return client().from('dew_destinations').delete().eq('id', id); },

    getDewReadings:     async function() { return client().from('dew_meter_readings').select('*').order('date', { ascending: false }); },
    upsertDewReading:   async function(row) { return client().from('dew_meter_readings').upsert(row); },
    deleteDewReading:   async function(id) { return client().from('dew_meter_readings').delete().eq('id', id); },

    getDewWaterLevels:  async function() { return client().from('dew_water_levels').select('*').order('date', { ascending: false }); },
    upsertDewLevel:     async function(row) { return client().from('dew_water_levels').upsert(row); },
    deleteDewLevel:     async function(id) { return client().from('dew_water_levels').delete().eq('id', id); },

    // ── Dust suppression ──────────────────────────────────────
    getDustOrgs:        async function() { return client().from('dust_orgs').select('*').order('name'); },
    upsertDustOrg:      async function(row) { return client().from('dust_orgs').upsert(row); },
    deleteDustOrg:      async function(id) { return client().from('dust_orgs').delete().eq('id', id); },

    getDustVehicles:    async function() { return client().from('dust_vehicles').select('*').order('name'); },
    upsertDustVehicle:  async function(row) { return client().from('dust_vehicles').upsert(row); },
    deleteDustVehicle:  async function(id) { return client().from('dust_vehicles').delete().eq('id', id); },

    getDustNozzles:     async function() { return client().from('dust_nozzles').select('*').order('name'); },
    upsertDustNozzle:   async function(row) { return client().from('dust_nozzles').upsert(row); },
    deleteDustNozzle:   async function(id) { return client().from('dust_nozzles').delete().eq('id', id); },

    getDustLogs:        async function() { return client().from('dust_logs').select('*').order('date', { ascending: false }); },
    upsertDustLog:      async function(row) { return client().from('dust_logs').upsert(row); },
    deleteDustLog:      async function(id) { return client().from('dust_logs').delete().eq('id', id); },
  };
})();
