/**
 * storage.js — localStorage как кэш и офлайн-очередь.
 * Не является источником истины — только буфер.
 */

const Storage = (() => {
  const KEYS = {
    POINTS:    'gm_points',
    WORKERS:   'gm_workers',
    QUEUE:     'gm_queue',
    DEVICE_ID: 'gm_device_id',
    SCHEMES:   'gm_schemes',
    HORIZONS:  'gm_horizons',
    SYNC_INTERVAL: 'gm_sync_interval',
  };

  // ── deviceId ─────────────────────────────────────────────

  function getDeviceId() {
    let id = localStorage.getItem(KEYS.DEVICE_ID);
    if (!id) {
      const rnd  = Math.random().toString(36).slice(2, 6);
      const type = /Mobi|Android/i.test(navigator.userAgent) ? 'mob' : 'dsk';
      id = type + rnd;
      localStorage.setItem(KEYS.DEVICE_ID, id);
    }
    return id;
  }

  // ── helpers ───────────────────────────────────────────────

  function load(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch (_) {
      return null;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('[Storage] save error:', e);
    }
  }

  // ── points cache ──────────────────────────────────────────

  function cachePoints(points) {
    save(KEYS.POINTS, points);
  }

  function getCachedPoints() {
    return load(KEYS.POINTS) || [];
  }

  // ── workers cache ─────────────────────────────────────────

  function cacheWorkers(workers) {
    save(KEYS.WORKERS, workers);
  }

  function getCachedWorkers() {
    return load(KEYS.WORKERS) || [];
  }

  // ── horizons (list of bench levels) ─────────────────────

  function getSyncInterval() {
    // Возвращает интервал в мс, по умолчанию 30 секунд
    var v = load(KEYS.SYNC_INTERVAL);
    return v ? Number(v) : 30000;
  }
  function saveSyncInterval(ms) {
    save(KEYS.SYNC_INTERVAL, ms);
  }

  function getHorizons() {
    return load(KEYS.HORIZONS) || [];
  }

  function saveHorizons(list) {
    save(KEYS.HORIZONS, list);
  }

  // ── schemes cache ─────────────────────────────────────────

  function cacheSchemes(schemes) {
    save(KEYS.SCHEMES, schemes);
  }

  function getCachedSchemes() {
    return load(KEYS.SCHEMES) || [];
  }

  // ── offline queue ─────────────────────────────────────────

  /**
   * Элемент очереди:
   * { id, action: 'createPoint'|'updatePoint'|'deletePoint', payload, addedAt }
   */

  function getQueue() {
    return load(KEYS.QUEUE) || [];
  }

  function addToQueue(action, payload) {
    const queue = getQueue();
    // Не дублируем: если для той же точки уже есть createPoint — заменяем
    const idx = queue.findIndex(
      item => item.payload && item.payload.id === (payload.id || payload) &&
              item.action === action
    );
    const entry = { id: Date.now(), action, payload, addedAt: new Date().toISOString() };
    if (idx >= 0) {
      queue[idx] = entry;
    } else {
      queue.push(entry);
    }
    save(KEYS.QUEUE, queue);
    return entry;
  }

  function removeFromQueue(entryId) {
    const queue = getQueue().filter(item => item.id !== entryId);
    save(KEYS.QUEUE, queue);
  }

  function clearQueue() {
    save(KEYS.QUEUE, []);
  }

  // ── очистка всего кэша ────────────────────────────────────

  function clearAll() {
    [KEYS.POINTS, KEYS.WORKERS, KEYS.QUEUE, KEYS.SCHEMES].forEach(k => {
      localStorage.removeItem(k);
    });
  }

  return {
    getDeviceId,
    cachePoints, getCachedPoints,
    cacheWorkers, getCachedWorkers,
    cacheSchemes, getCachedSchemes,
    getHorizons, saveHorizons,
    getSyncInterval, saveSyncInterval,
    getQueue, addToQueue, removeFromQueue, clearQueue,
    clearAll,
  };
})();
