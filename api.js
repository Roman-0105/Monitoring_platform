/**
 * api.js — единственный модуль для общения с Supabase.
 *
 * Использует официальный Supabase JS SDK v2 (подключается в index.html).
 * Все методы возвращают Promise с camelCase-объектами (как раньше).
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

  // ── Маппинг полей camelCase ↔ snake_case ─────────────────

  function pointToRow(p) {
    return {
      id:              p.id,
      version:         p.version         || 1,
      device_id:       p.deviceId        || '',
      sync_status:     'synced',
      synced_at:       new Date().toISOString(),
      created_at:      p.createdAt       || new Date().toISOString(),
      updated_at:      p.updatedAt       || new Date().toISOString(),
      monitoring_date: p.monitoringDate  || null,
      point_number:    p.pointNumber     || '',
      worker:          p.worker          || '',
      lat:             p.lat             != null ? p.lat  : null,
      lon:             p.lon             != null ? p.lon  : null,
      x_local:         p.xLocal          != null ? p.xLocal : null,
      y_local:         p.yLocal          != null ? p.yLocal : null,
      intensity:       p.intensity       || '',
      flow_rate:       p.flowRate        != null ? p.flowRate : null,
      water_color:     p.waterColor      || '',
      wall:            p.wall            || '',
      domain:          p.domain          || '',
      status:          p.status          || 'Новая',
      measure_method:  p.measureMethod   || '',
      horizon:         p.horizon         || '',
      comment:         p.comment         || '',
      photo_urls:      Array.isArray(p.photoUrls) ? p.photoUrls : [],
    };
  }

  function rowToPoint(r) {
    return {
      id:             r.id,
      version:        r.version,
      deviceId:       r.device_id,
      syncStatus:     r.sync_status,
      syncedAt:       r.synced_at,
      createdAt:      r.created_at,
      updatedAt:      r.updated_at,
      monitoringDate: r.monitoring_date,
      pointNumber:    r.point_number,
      worker:         r.worker,
      lat:            r.lat,
      lon:            r.lon,
      xLocal:         r.x_local,
      yLocal:         r.y_local,
      intensity:      r.intensity,
      flowRate:       r.flow_rate,
      waterColor:     r.water_color,
      wall:           r.wall,
      domain:         r.domain,
      status:         r.status,
      measureMethod:  r.measure_method,
      horizon:        r.horizon,
      comment:        r.comment,
      photoUrls:      r.photo_urls || [],
    };
  }

  function workerToRow(w) {
    return {
      id:         w.id,
      name:       w.name,
      active:     w.active !== false,
      created_at: w.createdAt || new Date().toISOString(),
      updated_at: w.updatedAt || new Date().toISOString(),
    };
  }

  function rowToWorker(r) {
    return {
      id:        r.id,
      name:      r.name,
      active:    r.active,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  // ── Вспомогательная: base64 → Blob ───────────────────────

  function base64ToBlob(base64, mimeType) {
    var byteString = atob(base64);
    var arr = new Uint8Array(byteString.length);
    for (var i = 0; i < byteString.length; i++) {
      arr[i] = byteString.charCodeAt(i);
    }
    return new Blob([arr], { type: mimeType || 'image/jpeg' });
  }

  // ── Points ────────────────────────────────────────────────

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

  // ── Workers ───────────────────────────────────────────────

  async function getWorkers() {
    var { data, error } = await client()
      .from('workers').select('*').order('name');
    if (error) throw new Error(error.message);
    return (data || []).map(rowToWorker);
  }

  async function saveWorker(worker) {
    var { error } = await client().from('workers').upsert(workerToRow(worker));
    if (error) throw new Error(error.message);
  }

  async function deleteWorker(id) {
    var { error } = await client().from('workers').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Schemes ───────────────────────────────────────────────

  async function getSchemes() {
    var { data, error } = await client()
      .from('schemes').select('*')
      .order('week_key', { ascending: false });
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
    if (uploadError) throw new Error(uploadError.message);

    var { error: dbError } = await client().from('schemes').upsert({
      week_key:     params.weekKey,
      storage_path: path,
      uploaded_at:  new Date().toISOString(),
      uploaded_by:  params.uploadedBy || '',
    });
    if (dbError) throw new Error(dbError.message);
  }

  // ── Photos ────────────────────────────────────────────────

  async function uploadPhotoConfirmed(pointId, fileName, base64, mimeType) {
    var blob = base64ToBlob(base64, mimeType);
    var path = pointId + '/' + Date.now() + '_' + fileName;

    var { error: uploadError } = await client().storage
      .from('photos').upload(path, blob, { upsert: true, contentType: mimeType });
    if (uploadError) throw new Error(uploadError.message);

    var urlResult = client().storage.from('photos').getPublicUrl(path);
    var photoUrl  = urlResult.data ? urlResult.data.publicUrl : path;

    // Добавляем URL к массиву photo_urls точки
    var { data: row, error: fetchError } = await client()
      .from('points').select('photo_urls').eq('id', pointId).maybeSingle();
    if (fetchError) throw new Error(fetchError.message);

    var existing = (row && row.photo_urls) || [];
    var updated  = [photoUrl].concat(existing);

    var { error: updateError } = await client().from('points')
      .update({ photo_urls: updated, updated_at: new Date().toISOString() })
      .eq('id', pointId);
    if (updateError) throw new Error(updateError.message);

    return photoUrl;
  }

  async function deletePhoto(pointId) {
    var { error } = await client().from('points')
      .update({ photo_urls: [], updated_at: new Date().toISOString() })
      .eq('id', pointId);
    if (error) throw new Error(error.message);
  }

  // ── История точки ─────────────────────────────────────────

  async function getHistory(pointNumber) {
    var { data, error } = await client()
      .from('points').select('*')
      .eq('point_number', pointNumber)
      .order('monitoring_date', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(rowToPoint);
  }

  async function getPhotos(pointNumber) {
    var { data, error } = await client()
      .from('points').select('photo_urls, monitoring_date')
      .eq('point_number', pointNumber)
      .order('monitoring_date', { ascending: false });
    if (error) throw new Error(error.message);
    var photos = [];
    (data || []).forEach(function(r) {
      (r.photo_urls || []).forEach(function(url) {
        photos.push({ url: url, monitoringDate: r.monitoring_date });
      });
    });
    return photos;
  }

  // ── Ping / совместимость ──────────────────────────────────

  async function ping() {
    try {
      var { error } = await client().from('points').select('id').limit(1);
      return !error;
    } catch (_) {
      return false;
    }
  }

  // getImage больше не нужен — фото доступны по прямым URL
  function getImage() {
    return Promise.resolve(null);
  }

  return {
    getPoints:    getPoints,
    getPoint:     getPoint,
    getWorkers:   getWorkers,
    getSchemes:   getSchemes,
    getHistory:   getHistory,
    getPhotos:    getPhotos,
    getDitches:   function() { return Promise.resolve({ ditches: [] }); },
    getDitchHistory: function() { return Promise.resolve({ history: [] }); },
    post:         function() { return Promise.resolve(); },
    getImage:     getImage,
    ping:         ping,
    createPoint:  createPoint,
    updatePoint:  updatePoint,
    deletePoint:  deletePoint,
    saveWorker:   saveWorker,
    deleteWorker: deleteWorker,
    uploadPhotoConfirmed: uploadPhotoConfirmed,
    deletePhoto:  deletePhoto,
    uploadScheme: uploadScheme,
  };
})();
