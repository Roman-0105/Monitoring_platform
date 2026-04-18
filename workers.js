/**
 * workers.js — загрузка и управление списком сотрудников.
 * Источник истины: Google Sheets.
 * localStorage: только кэш для офлайн-режима.
 */

const Workers = (() => {
  let _list = []; // текущий список в памяти

  async function load() {
    try {
      const workers = await Api.getWorkers();
      _list = workers;
      Storage.cacheWorkers(workers);
      Diagnostics.set('workersLoaded', workers.length);
      return workers;
    } catch (err) {
      Diagnostics.setError('sync', 'Сотрудники: ' + err.message);
      // Возвращаем кэш
      _list = Storage.getCachedWorkers();
      Diagnostics.set('workersLoaded', _list.length);
      return _list;
    }
  }

  function getList() {
    return _list;
  }

  async function add(name) {
    const worker = {
      id:        'w-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      name:      name.trim(),
      active:    true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    _list.push(worker);
    Storage.cacheWorkers(_list);
    try {
      await Api.saveWorker(worker);
    } catch (err) {
      Diagnostics.setError('sync', 'Сохранение сотрудника: ' + err.message);
    }
    return worker;
  }

  async function remove(id) {
    _list = _list.filter(w => w.id !== id);
    Storage.cacheWorkers(_list);
    try {
      await Api.deleteWorker(id);
    } catch (err) {
      Diagnostics.setError('sync', 'Удаление сотрудника: ' + err.message);
    }
  }

  return { load, getList, add, remove };
})();
