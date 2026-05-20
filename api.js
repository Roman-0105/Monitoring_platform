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
    var { data, error } = await client()
      .from('points').select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(rowToPoint);
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
    var { data, error } = await client()
      .from('schemes').select('*').order('week_key', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(function(r) {
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

  async function uploadScheme(params) {
    var ext  = (params.mimeType || 'image/jpeg').split('/')[1] || 'jpg';
    var path = params.weekKey + '.' + ext;
    var blob = base64ToBlob(params.base64, params.mimeType);

    var { error: uploadError } = await client().storage
      .from('schemes').upload(path, blob, { upsert: true, contentType: params.mimeType });
    if (uploadError) throw new Error('Storage: ' + uploadError.message + ' (status ' + (uploadError.statusCode || uploadError.status || '?') + ')');

    var { error: dbError } = await client().from('schemes').upsert({
      week_key:     params.weekKey,
      storage_path: path,
      uploaded_at:  new Date().toISOString(),
      uploaded_by:  params.uploadedBy || '',
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

  async function deletePhoto(pointId) {
    var { error } = await client()
      .from('points').update({ photos: [] }).eq('id', pointId);
    if (error) throw new Error(error.message);
  }

  // ── Ditches CRUD ──────────────────────────────────────────

  async function getDitches(pointNumber) {
    var query = client().from('ditches').select('*').order('created_at', { ascending: false });
    if (pointNumber) query = query.eq('point_number', pointNumber);
    var { data, error } = await query;
    if (error) throw new Error(error.message);
    return { ditches: (data || []).map(rowToDitch) };
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

  // ── Ping ─────────────────────────────────────────────────

  async function ping() {
    try {
      var { error } = await client().from('points').select('id').limit(1);
      return !error;
    } catch (_) { return false; }
  }

  function getImage() { return Promise.resolve(null); }

  // ── Маппинг wells ─────────────────────────────────────────

  function wellToRow(w) {
    return {
      id:               w.id,
      name:             w.name             || '',
      domain:           w.domain           || '',
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
      created_at:       w.createdAt        || new Date().toISOString(),
    };
  }

  function rowToWell(r) {
    return {
      id:             r.id,
      name:           r.name,
      domain:         r.domain,
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
    var { data, error } = await client()
      .from('wells').select('*').order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(rowToWell);
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
    getPoints:           getPoints,
    getPoint:            getPoint,
    getWorkers:          getWorkers,
    getHistory:          getHistory,
    getPhotos:           getPhotos,
    getSchemes:          getSchemes,
    getDitches:          getDitches,
    getDitch:            getDitch,
    getDitchHistory:     getDitchHistory,
    ping:                ping,
    getImage:            getImage,
    post:                function() { return Promise.resolve(); },
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
  };
})();
