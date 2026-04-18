/**
 * points.js — CRUD точек + офлайн-очередь.
 * Источник истины: Google Sheets.
 *
 * ИСПРАВЛЕНИЯ v2:
 *  - makePoint: wgs84ToSK42 → wgs84ToXY (имя метода MapModule)
 *  - makePoint: guard typeof MapModule проверяется корректно
 *
 * v3: добавлено поле monitoringDate (дата проведения мониторинга, YYYY-MM-DD)
 */

const Points = (() => {
  let _list = [];

  // ── helpers ───────────────────────────────────────────────

  function makeId() {
    const ts  = Date.now();
    const dev = Storage.getDeviceId();
    const rnd = Math.random().toString(36).slice(2, 6);
    return ts + '-' + dev + '-' + rnd;
  }

  function makePoint(data) {
    const now = new Date().toISOString();

    // Вычисляем xLocal / yLocal из GPS только если метод реально существует
    let xLocal = data.xLocal != null ? data.xLocal : null;
    let yLocal = data.yLocal != null ? data.yLocal : null;

    if ((xLocal == null || yLocal == null) && data.lat && data.lon &&
        typeof MapModule !== 'undefined' && typeof MapModule.wgs84ToXY === 'function') {
      const sk = MapModule.wgs84ToXY(data.lat, data.lon);
      if (xLocal == null) xLocal = sk.x;
      if (yLocal == null) yLocal = sk.y;
    }

    // monitoringDate — дата мониторинга в формате YYYY-MM-DD
    // Если не передана — ставим сегодня
    const today = now.slice(0, 10);

    return {
      id:             data.id             || makeId(),
      version:        data.version        || 1,
      deviceId:       data.deviceId       || Storage.getDeviceId(),
      syncStatus:     data.syncStatus     || 'pending',
      syncedAt:       data.syncedAt       || null,
      createdAt:      data.createdAt      || now,
      updatedAt:      data.updatedAt      || now,
      monitoringDate: data.monitoringDate || today,
      pointNumber:    data.pointNumber    || '',
      worker:         data.worker         || '',
      lat:            data.lat            != null ? data.lat  : null,
      lon:            data.lon            != null ? data.lon  : null,
      xLocal:         xLocal,
      yLocal:         yLocal,
      intensity:      data.intensity      || '',
      flowRate:       data.flowRate       != null ? data.flowRate : null,
      waterColor:     data.waterColor     || '',
      wall:           data.wall           || '',
      domain:         data.domain         || '',
      status:         data.status         || 'Новая',
      measureMethod:  data.measureMethod  || '',
      horizon:        data.horizon        || '',
      comment:        data.comment        || '',
      photoUrls:      data.photoUrls      || [],
    };
  }

  // ── загрузка ──────────────────────────────────────────────

  async function load() {
    try {
      const points = await Api.getPoints();
      _list = points.map(makePoint);
      Storage.cachePoints(_list);
      Diagnostics.set('pointsLoaded', _list.length);
      Diagnostics.set('lastSyncAt', new Date().toISOString());
      return _list;
    } catch (err) {
      Diagnostics.setError('sync', 'Точки: ' + err.message);
      _list = Storage.getCachedPoints().map(makePoint);
      Diagnostics.set('pointsLoaded', _list.length);
      return _list;
    }
  }

  function getList() {
    return _list;
  }

  function getById(id) {
    return _list.find(p => p.id === id) || null;
  }

  // ── create ────────────────────────────────────────────────

  async function create(data) {
    const point = makePoint(data);
    _list.unshift(point);
    Storage.cachePoints(_list);

    if (!navigator.onLine) {
      Storage.addToQueue('createPoint', point);
      Diagnostics.set('queueSize', Storage.getQueue().length);
      return point;
    }

    try {
      await Api.createPoint(point);
      point.syncStatus = 'synced';
      point.syncedAt   = new Date().toISOString();
      Storage.cachePoints(_list);
      Diagnostics.set('lastSyncAt', new Date().toISOString());
    } catch (err) {
      point.syncStatus = 'error';
      Storage.addToQueue('createPoint', point);
      Diagnostics.set('queueSize', Storage.getQueue().length);
      Diagnostics.setError('sync', 'Создание точки: ' + err.message);
    }

    return point;
  }

  // ── update ────────────────────────────────────────────────

  async function update(id, changes) {
    const idx = _list.findIndex(p => p.id === id);
    if (idx < 0) throw new Error('Точка не найдена: ' + id);

    const point = {
      ...makePoint(_list[idx]),
      ...changes,
      id,
      version:   (_list[idx].version || 1) + 1,
      updatedAt: new Date().toISOString(),
    };
    _list[idx] = point;
    Storage.cachePoints(_list);

    if (!navigator.onLine) {
      Storage.addToQueue('updatePoint', point);
      Diagnostics.set('queueSize', Storage.getQueue().length);
      return point;
    }

    try {
      await Api.updatePoint(point);
      point.syncStatus = 'synced';
      point.syncedAt   = new Date().toISOString();
      Storage.cachePoints(_list);
      Diagnostics.set('lastSyncAt', new Date().toISOString());
    } catch (err) {
      point.syncStatus = 'error';
      Storage.addToQueue('updatePoint', point);
      Diagnostics.set('queueSize', Storage.getQueue().length);
      Diagnostics.setError('sync', 'Обновление точки: ' + err.message);
    }

    return point;
  }

  // ── delete ────────────────────────────────────────────────

  async function remove(id) {
    _list = _list.filter(p => p.id !== id);
    Storage.cachePoints(_list);
    Diagnostics.set('pointsLoaded', _list.length);

    if (!navigator.onLine) {
      Storage.addToQueue('deletePoint', { id });
      Diagnostics.set('queueSize', Storage.getQueue().length);
      return;
    }

    try {
      await Api.deletePoint(id);
      Diagnostics.set('lastSyncAt', new Date().toISOString());
    } catch (err) {
      Storage.addToQueue('deletePoint', { id });
      Diagnostics.set('queueSize', Storage.getQueue().length);
      Diagnostics.setError('sync', 'Удаление точки: ' + err.message);
    }
  }

  // ── офлайн-очередь ───────────────────────────────────────

  async function flushQueue() {
    const queue = Storage.getQueue();
    if (!queue.length) return;

    let sent = 0;
    for (const item of queue) {
      try {
        if (item.action === 'createPoint') await Api.createPoint(item.payload);
        if (item.action === 'updatePoint') await Api.updatePoint(item.payload);
        if (item.action === 'deletePoint') await Api.deletePoint(item.payload.id);
        Storage.removeFromQueue(item.id);
        sent++;
      } catch (err) {
        Diagnostics.setError('sync', 'Очередь (' + item.action + '): ' + err.message);
        break;
      }
    }

    Diagnostics.set('queueSize', Storage.getQueue().length);
    if (sent > 0) {
      Diagnostics.set('lastSyncAt', new Date().toISOString());
      await load();
    }
  }

  return { load, getList, getById, create, update, remove, flushQueue, makeId };
})();
