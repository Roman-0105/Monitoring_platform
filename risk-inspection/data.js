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
 *   GEOLOCATION_SCHEMES(ID, DELETED, RECORD_VERSION, PLOT_NAME, WEEK_KEY, IMAGE,
 *                        X_MIN, X_MAX, Y_MIN, Y_MAX, UPLOADED_AT, UPLOADED_BY)
 *     — одна схема на PLOT_NAME + WEEK_KEY (напр. "2026-W29"), новая
 *       неделя = новая запись, а не замена; X_MIN..Y_MAX — границы в той
 *       же системе координат, что и CALLLOG.X/CALLLOG.Y (СК-42), для
 *       проекции точек обращений (тоже отфильтрованных по неделе — см.
 *       CALLLOG.DDATE) на схему. Порт того же 2-точечного калибровочного
 *       расчёта, что используется в проекте
 *       "Гидрогеологический мониторинг" (map.js/ui-settings.js).
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

  var TABLES = ['calllog', 'actions', 'fixedRisks', 'indicators', 'levels', 'plotNames',
    'notifications', 'notificationRecipients', 'contacts', 'schemes', 'faults', 'domains'];

  function ensureTables(d) {
    // Заполняет отсутствующие таблицы пустыми массивами — нужно, если в
    // localStorage лежат данные, сохранённые до появления новой сущности
    // (например, "schemes" добавили позже, чем у пользователя уже был кэш).
    TABLES.forEach(function(t) { if (!Array.isArray(d[t])) d[t] = []; });
    if (!d.colors || typeof d.colors !== 'object') d.colors = {};
    if (!d.meta || typeof d.meta !== 'object') d.meta = {};
    migrateGeologySeedV2(d);
    return d;
  }

  // Разломы/домены карьера ЮРГ добавились в seedDb() уже ПОСЛЕ того, как
  // часть пользователей могла успеть открыть панель — у них в localStorage
  // faults/domains уже существуют как пустые массивы (см. TABLES.forEach
  // выше), поэтому обычная "довалидация отсутствующих таблиц" их не
  // подхватывает. Разовая миграция (флаг d.meta.geologySeededV2) доливает
  // реальную геологию в УЖЕ существующую базу, не трогая остальные данные
  // (в т.ч. уже загруженную/откалиброванную пользователем схему).
  //
  // V2, а не V1: первая версия (флаг geologySeeded, теперь не используется)
  // ошибочно переставляла оси X/Y местами — совпадение с собственными
  // придуманными демо-границами приняли за подтверждение, а реальная
  // калибровка администратора (X: 45850-47350, Y: 15800-17350 — точно
  // диапазон из docstring domens.js) показала, что переставлять было не
  // нужно. V2 не просто доливает недостающее, а сначала СНОСИТ все ранее
  // авто-импортированные записи (по createdBy === RI_GEOLOGY_IMPORT_LABEL —
  // руками нарисованные пользователем фигуры не трогает) и вставляет их
  // заново уже с исправленными (см. RI_FAULTS_SEED/RI_DOMAINS_SEED в
  // seed-geology.js) координатами. Флаг не даёт повторно навязывать
  // удалённые пользователем разломы/домены после этой разовой правки.
  function findYurgPlot(d) {
    // Точное совпадение сначала; затем без учёта регистра/пробелов (мало ли
    // лишний пробел или другой регистр закрался при ручном редактировании
    // справочника); и только в самом крайнем случае — id=1, как в исходном
    // сиде (см. seed.js: plotNames[0] всегда "Карьер ЮРГ"). Раньше здесь было
    // только точное совпадение, а флаг migrateGeologySeededV2 всё равно
    // выставлялся как "готово" даже если участок не нашёлся — из-за этого
    // при малейшем расхождении строки геология не могла домигрировать
    // никогда. Теперь ищем настойчивее, а не сдаёмся после первой попытки.
    var byExact = d.plotNames.find(function(p) { return !p.deleted && p.plotName === 'Карьер ЮРГ'; });
    if (byExact) return byExact;
    var norm = function(s) { return (s || '').trim().toLowerCase().replace(/\s+/g, ' '); };
    var byLoose = d.plotNames.find(function(p) { return !p.deleted && norm(p.plotName) === 'карьер юрг'; });
    if (byLoose) return byLoose;
    return d.plotNames.find(function(p) { return !p.deleted && p.id === 1; }) || null;
  }

  function migrateGeologySeedV2(d) {
    if (d.meta.geologySeededV2) return;
    // Если seed-geology.js почему-то ещё не подгрузился (нарушен порядок
    // <script> в index.html) — не выставляем флаг, попробуем снова при
    // следующей загрузке страницы, а не потеряем шанс смигрировать навсегда.
    if (typeof RI_FAULTS_SEED === 'undefined' || typeof RI_DOMAINS_SEED === 'undefined') return;
    var plot = findYurgPlot(d);
    // Если участок в принципе не нашёлся ни одним из трёх способов (например,
    // у пользователя вообще нет ни одного участка) — тоже не выставляем флаг:
    // это значит попробовать ещё раз при следующей загрузке имеет смысл
    // (участок мог появиться позже), а не "успешно смигрировать ничего".
    if (!plot) return;
    d.meta.geologySeededV2 = true;
    d.faults = d.faults.filter(function(f) { return !(f.plotName === plot.id && f.createdBy === RI_GEOLOGY_IMPORT_LABEL); });
    d.domains = d.domains.filter(function(x) { return !(x.plotName === plot.id && x.createdBy === RI_GEOLOGY_IMPORT_LABEL); });
    RI_FAULTS_SEED.forEach(function(points) {
      d.faults.push({
        id: nextLocalId(d.faults), deleted: 0, recordVersion: 0, plotName: plot.id,
        name: '', points: points, createdAt: '2026-06-01T00:00:00', createdBy: RI_GEOLOGY_IMPORT_LABEL,
      });
    });
    RI_DOMAINS_SEED.forEach(function(dm) {
      d.domains.push({
        id: nextLocalId(d.domains), deleted: 0, recordVersion: 0, plotName: plot.id,
        name: dm.name, points: dm.pts, color: dm.color,
        createdAt: '2026-06-01T00:00:00', createdBy: RI_GEOLOGY_IMPORT_LABEL,
      });
    });
  }
  // То же, что nextId(table), но принимает массив напрямую — на этом этапе
  // (внутри ensureTables) модульная переменная db ещё не назначена.
  function nextLocalId(rows) {
    var max = 0;
    rows.forEach(function(r) { if (r.id > max) max = r.id; });
    return max + 1;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(LS_KEY); } catch (e) { /* недоступен localStorage */ }

    if (raw) {
      var parsed = null;
      try { parsed = JSON.parse(raw); } catch (e) { /* повреждённый JSON — пересидим с нуля ниже */ }
      if (parsed) {
        var before = parsed.meta && parsed.meta.geologySeededV2;
        db = ensureTables(parsed);
        // ensureTables() может дозаполнить недостающие таблицы и разово
        // смигрировать геологию (migrateGeologySeedV2) — сохраняем сразу,
        // а не откладываем до следующего "естественного" persist(),
        // иначе миграция будет молча повторяться в памяти на каждой
        // перезагрузке страницы, так и не попав в localStorage. Если
        // именно ЭТОТ persist() провалится (например, забита квота
        // браузера) — это не повод стирать уже распарсенные РЕАЛЬНЫЕ
        // данные пользователя реседом ниже: db уже корректно назначен в
        // памяти на этот сеанс, а сам persist() уже показал тост с
        // ошибкой — раньше такая ошибка попадала в тот же catch, что и
        // повреждённый JSON, и приводила именно к такому стиранию.
        if (!before) { try { persist(); } catch (e) { /* тост уже показан внутри persist() */ } }
        return;
      }
    }
    db = ensureTables(seedDb());
    persist();
  }
  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(db)); }
    catch (e) {
      Toast.show('Не удалось сохранить: переполнено хранилище браузера. Попробуйте изображение меньшего размера.', 'error');
      e.alreadyToasted = true; // чтобы вызывающий код не показывал поверх свой (менее понятный) тост
      throw e;
    }
  }
  // Только для ручного вызова из консоли браузера (см. README.md) —
  // стирает все локальные правки и возвращает тестовые данные к исходному
  // сиду; в самом UI кнопки для этого нет намеренно (слишком разрушительно
  // для случайного клика).
  function resetToSeed() { db = seedDb(); persist(); }

  // Компактный снимок состояния для кнопки "🩺 Диагностика" (ui-diagnostics.js) —
  // счётчики и ключевые поля, без огромных base64-полей (фото/схемы), чтобы
  // итоговый JSON помещался в один comfortable paste.
  function debugSnapshot() {
    var counts = {};
    TABLES.forEach(function(t) {
      counts[t] = (db[t] || []).filter(function(r) { return !r.deleted; }).length;
    });
    return {
      meta: db.meta,
      tableCounts: counts,
      plotNames: db.plotNames.filter(function(p) { return !p.deleted; })
        .map(function(p) { return { id: p.id, name: p.plotName }; }),
      schemes: db.schemes.filter(function(s) { return !s.deleted; }).map(function(s) {
        return {
          id: s.id, plotName: s.plotName, weekKey: s.weekKey, hasImage: !!s.image,
          xMin: s.xMin, xMax: s.xMax, yMin: s.yMin, yMax: s.yMax,
          uploadedAt: s.uploadedAt, uploadedBy: s.uploadedBy,
        };
      }),
    };
  }

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

  // Невалидная/отсутствующая дата даёт Invalid Date -> NaN при вычитании
  // (не бросает исключение, но и не даёт осмысленного порядка) — уводим её
  // в начало эпохи, чтобы такие строки предсказуемо уходили в конец
  // списка (сортировка "по убыванию даты"), а не путали остальной порядок.
  function ddateTime(v) {
    var t = new Date(v).getTime();
    return isNaN(t) ? 0 : t;
  }

  // API отдаёт `photo` только как имя файла (см. BACKEND_INTEGRATION.md,
  // 2.1/7) — decorateCallLog() строит полный URL для локального режима,
  // а этот хелпер делает то же самое поверх уже готового JSON от API
  // (плейсменты labels там уже посчитаны сервером, пересчитывать их
  // локально нельзя — id-справочники клиента и сервера могут не совпасть).
  function withPhotoUrl(row) {
    row.photoUrl = photoUrl(row.photo);
    return row;
  }

  async function getCallLog() {
    if (isRemote()) return (await remoteCall('GET', '/calllog')).map(withPhotoUrl);
    return db.calllog.filter(function(r) { return !r.deleted; })
      .map(decorateCallLog)
      .sort(function(a, b) { return ddateTime(b.ddate) - ddateTime(a.ddate); });
  }

  async function getCallLogById(id) {
    if (isRemote()) {
      var remoteRow = await remoteCall('GET', '/calllog/' + id);
      return remoteRow ? withPhotoUrl(remoteRow) : null;
    }
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
    // data: { fname, phone, comments, plotName, indicator, level, ddate, xwgs, ywgs, zwgs, xLocal, yLocal, photo }
    // photo — админ может загрузить/заменить фото прямо в карточке
    // обращения (см. ui-journal.js, вкладка "Информация по обращению") —
    // полезно для тестовых данных без реальных снимков с мобильной формы.
    if (isRemote()) return remoteCall('PUT', '/calllog/' + id, data);
    var row = db.calllog.find(function(r) { return r.id === id; });
    if (!row) throw new Error('Обращение не найдено');
    ['fname', 'phone', 'comments', 'plotName', 'indicator', 'level', 'ddate', 'xwgs', 'ywgs', 'zwgs', 'xLocal', 'yLocal', 'photo'].forEach(function(f) {
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

  async function addCallLog(data) {
    // data: { fname, phone, comments, plotName, indicator, level }
    // (ручной ввод обращения администратором — те же поля, что форма пишет
    // с телефона, кроме координат/фото/IP, которых у "ручной" записи нет)
    if (isRemote()) return remoteCall('POST', '/calllog', data);
    var row = {
      id: nextId('calllog'), deleted: 0, recordVersion: 0,
      fname: data.fname, phone: data.phone || '', comments: data.comments || '',
      photo: '', ip: 'manual-entry', closed: 0,
      xwgs: null, ywgs: null, zwgs: null, xLocal: null, yLocal: null,
      ddate: new Date().toISOString(),
      plotName: data.plotName, indicator: data.indicator, level: data.level != null ? data.level : null,
    };
    db.calllog.push(row);
    persist();
    return decorateCallLog(row);
  }

  async function removeCallLog(id) {
    if (isRemote()) return remoteCall('DELETE', '/calllog/' + id);
    var row = db.calllog.find(function(r) { return r.id === id; });
    if (!row) return;
    row.deleted = 1;
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

  var indicatorsApi = makeRefApi('indicators', ['indicator', 'fixedRisk']);

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

  /* ---------------- Схемы участков (одна активная схема на участок) ---------------- */

  function findSchemeRow(plotId, weekKey) {
    return db.schemes.find(function(s) { return s.plotName === plotId && s.weekKey === weekKey && !s.deleted; });
  }
  function listSchemeRows(plotId) {
    // (a.weekKey || '') — на случай, если в localStorage дожила запись схемы
    // с давних версий модели (до перехода на "участок + неделя", когда
    // WEEK_KEY ещё не было), либо weekKey иначе не проставился: раньше
    // .weekKey.localeCompare() на undefined ронял всю карту необработанным
    // исключением ещё до того, как код успевал дойти до подгрузки
    // разломов/доменов — снаружи это выглядело так, будто геология
    // "не подгружается", хотя дело было в этом падении чуть раньше по стеку.
    return db.schemes.filter(function(s) { return s.plotName === plotId && !s.deleted; })
      .sort(function(a, b) { return (b.weekKey || '').localeCompare(a.weekKey || ''); }); // новые недели сверху
  }

  // Как и с CALLLOG.PHOTO: сервер должен отдавать `image` именем файла
  // (полный URL = PHOTO_BASE_URL + IMAGE, см. BACKEND_INTEGRATION.md,
  // 2.2), поэтому клиент всегда строит отображаемую ссылку сам —
  // photoUrl() одинаково пропускает data:-URL тестового режима как есть
  // и достраивает URL из имени файла для боевого API.
  function withImageUrl(row) {
    if (row) row.imageUrl = photoUrl(row.image);
    return row;
  }

  var schemesApi = {
    // Все загруженные недели схем для участка, от новой к старой.
    listWeeks: async function(plotId) {
      if (isRemote()) return (await remoteCall('GET', '/schemes/' + plotId + '/weeks')).map(withImageUrl);
      return listSchemeRows(plotId).map(function(s) { return withImageUrl(Object.assign({}, s)); });
    },
    // Схема конкретной недели (или null).
    getByPlotWeek: async function(plotId, weekKey) {
      if (isRemote()) return withImageUrl(await remoteCall('GET', '/schemes/' + plotId + '/' + weekKey));
      var row = findSchemeRow(plotId, weekKey);
      return row ? withImageUrl(Object.assign({}, row)) : null;
    },
    // Самая свежая загруженная неделя для участка (или null) — используется
    // и как "неделя по умолчанию" на карте, и как источник границ при
    // создании схемы для ещё не существовавшей недели (перенос калибровки).
    getLatest: async function(plotId) {
      if (isRemote()) return withImageUrl(await remoteCall('GET', '/schemes/' + plotId + '/latest'));
      var rows = listSchemeRows(plotId);
      return rows.length ? withImageUrl(Object.assign({}, rows[0])) : null;
    },
    upload: async function(plotId, weekKey, image) {
      // image: сжатая data-URL картинки схемы
      var uploadedBy = (cfg().CURRENT_USER) || '';
      if (isRemote()) return withImageUrl(await remoteCall('POST', '/schemes/' + plotId + '/' + weekKey, { image: image, uploadedBy: uploadedBy }));
      var row = findSchemeRow(plotId, weekKey);
      if (row) {
        // Повторная загрузка на ТУ ЖЕ неделю — заменяет картинку, границы не трогаем.
        row.image = image; row.uploadedAt = new Date().toISOString(); row.uploadedBy = uploadedBy;
        row.recordVersion = (row.recordVersion || 0) + 1;
      } else {
        // Новая неделя — переносим границы с последней существующей недели
        // этого участка (админ может их подправить, не калибровать с нуля).
        var latest = listSchemeRows(plotId)[0];
        row = {
          id: nextId('schemes'), deleted: 0, recordVersion: 0, plotName: plotId, weekKey: weekKey,
          image: image, uploadedAt: new Date().toISOString(), uploadedBy: uploadedBy,
          xMin: latest ? latest.xMin : null, xMax: latest ? latest.xMax : null,
          yMin: latest ? latest.yMin : null, yMax: latest ? latest.yMax : null,
        };
        db.schemes.push(row);
      }
      persist();
      return withImageUrl(Object.assign({}, row));
    },
    saveBounds: async function(plotId, weekKey, bounds) {
      // bounds: {xMin, xMax, yMin, yMax}
      if (isRemote()) return remoteCall('PUT', '/schemes/' + plotId + '/' + weekKey + '/bounds', bounds);
      var row = findSchemeRow(plotId, weekKey);
      if (!row) throw new Error('Сначала загрузите изображение схемы для этой недели');
      row.xMin = bounds.xMin; row.xMax = bounds.xMax; row.yMin = bounds.yMin; row.yMax = bounds.yMax;
      row.recordVersion = (row.recordVersion || 0) + 1;
      persist();
      return Object.assign({}, row);
    },
    remove: async function(plotId, weekKey) {
      if (isRemote()) return remoteCall('DELETE', '/schemes/' + plotId + '/' + weekKey);
      var row = findSchemeRow(plotId, weekKey);
      if (!row) return;
      row.deleted = 1;
      persist();
    },
  };

  /* ---------------- Разломы и домены (геологические слои на карте) ----------------
   * Порт логики отрисовки Faults.draw/Domens.draw из проекта
   * "Гидрогеологический мониторинг" (map.js/faults.js/domens.js). В отличие
   * от оригинала (геометрия — единоразовый хардкод из DXF, без интерфейса
   * создания), здесь разломы/домены создаются прямо на карте (см. ui-map.js,
   * режим рисования) и хранятся по участку — координаты в той же локальной
   * системе X/Y, что и GEOLOCATION_SCHEMES.X_MIN..Y_MAX/CALLLOG.X,Y.
   */

  var faultsApi = {
    listByPlot: async function(plotId) {
      if (isRemote()) return remoteCall('GET', '/faults/' + plotId);
      return db.faults.filter(function(f) { return f.plotName === plotId && !f.deleted; })
        .map(function(f) { return Object.assign({}, f); });
    },
    add: async function(plotId, points, name) {
      // points: [[x,y], [x,y], ...] — минимум 2 точки
      var createdBy = cfg().CURRENT_USER || '';
      if (isRemote()) return remoteCall('POST', '/faults/' + plotId, { points: points, name: name, createdBy: createdBy });
      var row = {
        id: nextId('faults'), deleted: 0, recordVersion: 0, plotName: plotId,
        name: name || '', points: points, createdAt: new Date().toISOString(), createdBy: createdBy,
      };
      db.faults.push(row);
      persist();
      return Object.assign({}, row);
    },
    remove: async function(id) {
      if (isRemote()) return remoteCall('DELETE', '/faults/item/' + id);
      var row = db.faults.find(function(f) { return f.id === id; });
      if (!row) return;
      row.deleted = 1;
      persist();
    },
  };

  var domainsApi = {
    listByPlot: async function(plotId) {
      if (isRemote()) return remoteCall('GET', '/domains/' + plotId);
      return db.domains.filter(function(d) { return d.plotName === plotId && !d.deleted; })
        .map(function(d) { return Object.assign({}, d); });
    },
    // Все домены по всем участкам сразу, с названием участка — для вкладки
    // "Настройка цветов" (там нужно показать/перекрасить их одним списком).
    listAll: async function() {
      if (isRemote()) return remoteCall('GET', '/domains');
      return db.domains.filter(function(d) { return !d.deleted; }).map(function(d) {
        var plot = db.plotNames.find(function(p) { return p.id === d.plotName; });
        return Object.assign({}, d, { plotLabel: plot ? plot.plotName : '' });
      });
    },
    add: async function(plotId, points, name, color) {
      // points: [[x,y], ...] — минимум 3 точки (замкнутый полигон)
      var createdBy = cfg().CURRENT_USER || '';
      if (isRemote()) return remoteCall('POST', '/domains/' + plotId, { points: points, name: name, color: color, createdBy: createdBy });
      var row = {
        id: nextId('domains'), deleted: 0, recordVersion: 0, plotName: plotId,
        name: name || ('Домен ' + (db.domains.length + 1)), points: points, color: color || '#1a73e8',
        createdAt: new Date().toISOString(), createdBy: createdBy,
      };
      db.domains.push(row);
      persist();
      return Object.assign({}, row);
    },
    update: async function(id, data) {
      // data: {name?, color?}
      if (isRemote()) return remoteCall('PUT', '/domains/item/' + id, data);
      var row = db.domains.find(function(d) { return d.id === id; });
      if (!row) throw new Error('Домен не найден');
      if (data.name !== undefined) row.name = data.name;
      if (data.color !== undefined) row.color = data.color;
      row.recordVersion = (row.recordVersion || 0) + 1;
      persist();
      return Object.assign({}, row);
    },
    remove: async function(id) {
      if (isRemote()) return remoteCall('DELETE', '/domains/item/' + id);
      var row = db.domains.find(function(d) { return d.id === id; });
      if (!row) return;
      row.deleted = 1;
      persist();
    },
  };

  /* ---------------- Настройка цветов (уровни/риски/разломы) ----------------
   * Цвета доменов хранятся прямо в записи домена (domainsApi.update) — как
   * в Domens.setColors оригинала, только без промежуточного слоя "карта
   * имя->цвет", потому что домены здесь и так объекты с собственным id.
   */

  var DEFAULT_LEVEL_PALETTE = ['#fbbf24', '#fb923c', '#f87171', '#a78bfa', '#f472b6'];
  var DEFAULT_RISK_PALETTE = ['#22d3ee', '#a78bfa', '#fb923c', '#34d399', '#f472b6', '#facc15', '#60a5fa', '#f87171'];
  var DEFAULT_FAULT_COLOR = '#e05c5c'; // как в faults.js гидро-проекта

  var colorsApi = {
    // В удалённом режиме сервер сам должен домешивать цвета по умолчанию
    // для ещё не настроенных уровней/рисков (см. BACKEND_INTEGRATION.md,
    // 2.2) — клиент просто отдаёт ответ API как есть, не считая свою
    // палитру поверх (той всё равно нет смысла доверять чужие ID).
    getLevelColorMap: async function() {
      if (isRemote()) return remoteCall('GET', '/colors/levels');
      var levels = await levelsApi.list();
      var map = {};
      levels.forEach(function(l, i) {
        map[l.id] = (db.colors.levels && db.colors.levels[l.id]) || DEFAULT_LEVEL_PALETTE[i % DEFAULT_LEVEL_PALETTE.length];
      });
      return map;
    },
    setLevelColor: async function(levelId, hex) {
      if (isRemote()) return remoteCall('PUT', '/colors/levels/' + levelId, { color: hex });
      if (!db.colors.levels) db.colors.levels = {};
      db.colors.levels[levelId] = hex;
      persist();
    },
    getRiskColorMap: async function() {
      if (isRemote()) return remoteCall('GET', '/colors/risks');
      var risks = await fixedRisksApi.list();
      var map = {};
      risks.forEach(function(r, i) {
        map[r.id] = (db.colors.risks && db.colors.risks[r.id]) || DEFAULT_RISK_PALETTE[i % DEFAULT_RISK_PALETTE.length];
      });
      return map;
    },
    setRiskColor: async function(riskId, hex) {
      if (isRemote()) return remoteCall('PUT', '/colors/risks/' + riskId, { color: hex });
      if (!db.colors.risks) db.colors.risks = {};
      db.colors.risks[riskId] = hex;
      persist();
    },
    getFaultColor: async function() {
      if (isRemote()) return (await remoteCall('GET', '/colors/fault')).color;
      return (db.colors && db.colors.fault) || DEFAULT_FAULT_COLOR;
    },
    setFaultColor: async function(hex) {
      if (isRemote()) return remoteCall('PUT', '/colors/fault', { color: hex });
      db.colors.fault = hex;
      persist();
    },
  };

  load();

  return {
    calllog: { list: getCallLog, get: getCallLogById, close: closeCallLog, reopen: reopenCallLog, actions: getActionsByCallLogId, update: updateCallLog, add: addCallLog, remove: removeCallLog },
    fixedRisks: fixedRisksApi,
    indicators: indicatorsApi,
    levels: levelsApi,
    plotNames: plotNamesApi,
    notifications: notificationsApi,
    contacts: contactsApi,
    schemes: schemesApi,
    faults: faultsApi,
    domains: domainsApi,
    colors: colorsApi,
    photoUrl: photoUrl,
    _debugResetSeed: resetToSeed,
    _debugSnapshot: debugSnapshot,
  };
})();
