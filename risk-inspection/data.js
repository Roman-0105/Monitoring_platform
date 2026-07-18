/*
 * RiskApi — единая точка доступа к данным.
 *
 * СХЕМА ДАННЫХ 1:1 ПОВТОРЯЕТ РЕАЛЬНЫЕ ТАБЛИЦЫ SQL SERVER ПРЕДПРИЯТИЯ
 * (выгружены из Power BI, схема dbo):
 *
 *   GEOLOCATION_CALLLOG(ID, DELETED, RECORD_VERSION, FNAME, PHONE, COMMENTS,
 *                        PHOTO, IP, CLOSED, XWGS, YWGS, ZWGS, X, Y, DDATE,
 *                        PLOT_NAME, INDICATOR, LEVEL)
 *     — XWGS/YWGS/ZWGS: GPS (широта/долгота/высота); X/Y: локальные
 *       координаты СК-42 (видны в исходной форме обращения предприятия).
 *   GEOLOCATION_ACTIONS(ID, DELETED, TODO, DATE, PHOTO, CALLLOGID)
 *   GEOLOCATION_FIXED_RISKS(ID, DELETED, RECORD_VERSION, FIXED_RISK)
 *   GEOLOCATION_INDICATORS(ID, DELETED, RECORD_VERSION, INDICATOR, FIXED_RISK)
 *   GEOLOCATION_LEVELS(ID, DELETED, RECORD_VERSION, LEVEL)
 *   GEOLOCATION_PLOT_NAMES(ID, DELETED, RECORD_VERSION, PLOT_NAME)
 *
 * Плюс два справочника, которых пока нет в БД предприятия — спроектированы
 * в том же стиле (см. BACKEND_INTEGRATION.md для точной DDL):
 *   GEOLOCATION_NOTIFICATIONS(ID, DELETED, RECORD_VERSION, FIXED_RISK, LEVEL)
 *   GEOLOCATION_NOTIFICATION_RECIPIENTS(ID, DELETED, NOTIFICATION_ID, EMAIL)
 *   GEOLOCATION_CONTACTS(ID, DELETED, RECORD_VERSION, FNAME, POSITION, PHONE, EMAIL)
 *
 * ВАЖНОЕ ДОПУЩЕНИЕ (требует подтверждения у IT при подключении реального API):
 * поля CALLLOG.PLOT_NAME / .INDICATOR / .LEVEL и INDICATORS.FIXED_RISK трактуются
 * как целочисленные внешние ключи (по аналогии с INDICATORS.FIXED_RISK, где в
 * выгрузке видны именно числа 1..4). Если на деле там хранится текст —
 * потребуется только поправить rowToX-мапперы ниже, остальной код не изменится.
 *
 * Пока RISK_CONFIG.API_BASE_URL == null — всё работает на localStorage.
 * Как только IT поднимут REST API поверх SQL Server, здесь достаточно
 * реализовать ветку fetch() (заглушки уже расставлены ниже) — ui-*.js
 * трогать не придётся.
 */

var RiskApi = (function() {
  var LS_KEY = 'ri_db_v1';
  var db = null;

  function cfg() { return window.RISK_CONFIG || {}; }
  function isRemote() { return !!cfg().API_BASE_URL; }

  function nextId(table) {
    var rows = db[table];
    var max = 0;
    rows.forEach(function(r) { if (r.id > max) max = r.id; });
    return max + 1;
  }

  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) { db = JSON.parse(raw); return; }
    } catch (e) { /* ignore corrupt storage */ }
    db = seedDb();
    persist();
  }
  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(db)); }
    catch (e) { Toast.show('Не удалось сохранить локальные данные (переполнено хранилище браузера)', 'error'); }
  }
  function resetToSeed() { db = seedDb(); persist(); }

  /* ---------------- generic remote helper (для будущего API) ---------------- */
  async function remoteCall(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (cfg().API_KEY) headers['Authorization'] = 'Bearer ' + cfg().API_KEY;
    var res = await fetch(cfg().API_BASE_URL + path, {
      method: method, headers: headers, body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error('API ' + method + ' ' + path + ' -> ' + res.status);
    if (res.status === 204) return null;
    return res.json();
  }

  /* ---------------- CALLLOG (Журнал Обращений) ---------------- */

  function decorateCallLog(row) {
    var indicator = db.indicators.find(function(i) { return i.id === row.indicator; });
    var risk = indicator ? db.fixedRisks.find(function(r) { return r.id === indicator.fixedRisk; }) : null;
    var level = db.levels.find(function(l) { return l.id === row.level; });
    var plot = db.plotNames.find(function(p) { return p.id === row.plotName; });
    return {
      id: row.id,
      fname: row.fname,
      phone: row.phone,
      comments: row.comments,
      photo: row.photo,
      photoUrl: photoUrl(row.photo),
      ip: row.ip,
      closed: !!row.closed,
      xwgs: row.xwgs, ywgs: row.ywgs, zwgs: row.zwgs,
      xLocal: row.xLocal, yLocal: row.yLocal,
      ddate: row.ddate,
      plotNameId: row.plotName,
      plotName: plot ? plot.plotName : '',
      indicatorId: row.indicator,
      indicator: indicator ? indicator.indicator : '',
      fixedRiskId: risk ? risk.id : null,
      fixedRisk: risk ? risk.fixedRisk : '',
      levelId: row.level,
      level: level ? level.level : '',
    };
  }

  function photoUrl(photo) {
    if (!photo) return '';
    if (photo.indexOf('data:') === 0 || photo.indexOf('http') === 0) return photo;
    return (cfg().PHOTO_BASE_URL || '') + photo;
  }

  async function getCallLog() {
    if (isRemote()) return remoteCall('GET', '/calllog');
    return db.calllog.filter(function(r) { return !r.deleted; })
      .map(decorateCallLog)
      .sort(function(a, b) { return new Date(b.ddate) - new Date(a.ddate); });
  }

  async function getCallLogById(id) {
    if (isRemote()) return remoteCall('GET', '/calllog/' + id);
    var row = db.calllog.find(function(r) { return r.id === id; });
    return row ? decorateCallLog(row) : null;
  }

  async function getActionsByCallLogId(calllogId) {
    if (isRemote()) return remoteCall('GET', '/calllog/' + calllogId + '/actions');
    return db.actions.filter(function(a) { return a.calllogId === calllogId && !a.deleted; })
      .sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
  }

  async function closeCallLog(calllogId, data) {
    // data: { todo, photo }  (photo — data-URL строки, сжатое фото)
    if (isRemote()) return remoteCall('POST', '/calllog/' + calllogId + '/close', data);
    var row = db.calllog.find(function(r) { return r.id === calllogId; });
    if (!row) throw new Error('Обращение не найдено');
    var action = {
      id: nextId('actions'), deleted: 0, todo: data.todo, date: new Date().toISOString(),
      photo: data.photo || '', calllogId: calllogId,
    };
    db.actions.push(action);
    row.closed = 1;
    row.recordVersion = (row.recordVersion || 0) + 1;
    persist();
    return action;
  }

  async function updateCallLog(id, data) {
    // data: { fname, phone, comments, plotName, indicator, level, ddate, xwgs, ywgs, zwgs, xLocal, yLocal }
    if (isRemote()) return remoteCall('PUT', '/calllog/' + id, data);
    var row = db.calllog.find(function(r) { return r.id === id; });
    if (!row) throw new Error('Обращение не найдено');
    ['fname', 'phone', 'comments', 'plotName', 'indicator', 'level', 'ddate', 'xwgs', 'ywgs', 'zwgs', 'xLocal', 'yLocal'].forEach(function(f) {
      if (data[f] !== undefined) row[f] = data[f];
    });
    row.recordVersion = (row.recordVersion || 0) + 1;
    persist();
    return decorateCallLog(row);
  }

  async function reopenCallLog(calllogId) {
    if (isRemote()) return remoteCall('POST', '/calllog/' + calllogId + '/reopen');
    var row = db.calllog.find(function(r) { return r.id === calllogId; });
    if (!row) throw new Error('Обращение не найдено');
    row.closed = 0;
    persist();
  }

  /* ---------------- Универсальный CRUD для справочников ---------------- */

  function makeRefApi(table, fields, decorate) {
    return {
      list: async function() {
        if (isRemote()) return remoteCall('GET', '/' + table);
        var rows = db[table].filter(function(r) { return !r.deleted; });
        return decorate ? rows.map(decorate) : rows.slice();
      },
      add: async function(data) {
        if (isRemote()) return remoteCall('POST', '/' + table, data);
        var row = { id: nextId(table), deleted: 0, recordVersion: 0 };
        fields.forEach(function(f) { row[f] = data[f]; });
        db[table].push(row);
        persist();
        return row;
      },
      update: async function(id, data) {
        if (isRemote()) return remoteCall('PUT', '/' + table + '/' + id, data);
        var row = db[table].find(function(r) { return r.id === id; });
        if (!row) throw new Error('Запись не найдена');
        fields.forEach(function(f) { if (data[f] !== undefined) row[f] = data[f]; });
        row.recordVersion = (row.recordVersion || 0) + 1;
        persist();
        return row;
      },
      remove: async function(id) {
        if (isRemote()) return remoteCall('DELETE', '/' + table + '/' + id);
        var row = db[table].find(function(r) { return r.id === id; });
        if (row) { row.deleted = 1; persist(); }
      },
    };
  }

  var fixedRisksApi = makeRefApi('fixedRisks', ['fixedRisk']);
  var levelsApi = makeRefApi('levels', ['level']);
  var plotNamesApi = makeRefApi('plotNames', ['plotName']);

  var indicatorsApi = (function() {
    var base = makeRefApi('indicators', ['indicator', 'fixedRisk']);
    base.listByRisk = async function(riskId) {
      var all = await base.list();
      return riskId ? all.filter(function(i) { return i.fixedRisk === riskId; }) : all;
    };
    return base;
  })();

  /* ---------------- Уведомления ---------------- */

  var notificationsApi = {
    list: async function() {
      if (isRemote()) return remoteCall('GET', '/notifications');
      return db.notifications.filter(function(n) { return !n.deleted; }).map(function(n) {
        var risk = db.fixedRisks.find(function(r) { return r.id === n.fixedRisk; });
        var level = db.levels.find(function(l) { return l.id === n.level; });
        var recipients = db.notificationRecipients
          .filter(function(r) { return r.notificationId === n.id && !r.deleted; })
          .map(function(r) { return r.email; });
        return {
          id: n.id, fixedRiskId: n.fixedRisk, fixedRisk: risk ? risk.fixedRisk : '',
          levelId: n.level, level: level ? level.level : '', recipients: recipients,
        };
      });
    },
    upsert: async function(data) {
      // data: { id?, fixedRisk, level, recipients: [email,...] }
      if (isRemote()) return remoteCall('POST', '/notifications', data);
      var row;
      if (data.id) {
        row = db.notifications.find(function(n) { return n.id === data.id; });
        row.fixedRisk = data.fixedRisk; row.level = data.level || null;
        row.recordVersion = (row.recordVersion || 0) + 1;
        db.notificationRecipients.forEach(function(r) { if (r.notificationId === row.id) r.deleted = 1; });
      } else {
        row = { id: nextId('notifications'), deleted: 0, recordVersion: 0, fixedRisk: data.fixedRisk, level: data.level || null };
        db.notifications.push(row);
      }
      (data.recipients || []).forEach(function(email) {
        db.notificationRecipients.push({ id: nextId('notificationRecipients'), deleted: 0, notificationId: row.id, email: email });
      });
      persist();
      return row;
    },
    remove: async function(id) {
      if (isRemote()) return remoteCall('DELETE', '/notifications/' + id);
      var row = db.notifications.find(function(n) { return n.id === id; });
      if (row) row.deleted = 1;
      db.notificationRecipients.forEach(function(r) { if (r.notificationId === id) r.deleted = 1; });
      persist();
    },
  };

  var contactsApi = makeRefApi('contacts', ['fname', 'position', 'phone', 'email']);

  load();

  return {
    calllog: { list: getCallLog, get: getCallLogById, close: closeCallLog, reopen: reopenCallLog, actions: getActionsByCallLogId, update: updateCallLog },
    fixedRisks: fixedRisksApi,
    indicators: indicatorsApi,
    levels: levelsApi,
    plotNames: plotNamesApi,
    notifications: notificationsApi,
    contacts: contactsApi,
    photoUrl: photoUrl,
    _debugResetSeed: resetToSeed,
  };
})();
