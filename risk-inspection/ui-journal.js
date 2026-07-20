/* Журнал Обращений — главный экран панели */

var JournalState = {
  rows: [], filtered: [], page: 1, pageSize: 20,
  sortKey: 'ddate', sortDir: -1, search: '', selectedId: null,
};

async function initJournalPanel(panelEl) {
  panelEl.innerHTML =
    '<div class="ri-panel-card">' +
      '<div class="ri-panel-toolbar">' +
        '<span class="ri-panel-title">Журнал Обращений</span>' +
        '<input type="text" class="ri-input" id="ri-j-search" placeholder="Поиск: ФИО, участок, риск..." style="max-width:260px">' +
        '<button class="ri-btn ri-btn-icon" id="ri-j-refresh" title="Обновить">🔄</button>' +
      '</div>' +
      '<div class="ri-panel-body"><div class="ri-table-wrap" id="ri-j-table"></div></div>' +
      '<div class="ri-panel-footer">' +
        '<div class="ri-panel-footer-left" id="ri-j-pager"></div>' +
        '<button class="ri-btn ri-btn-danger" id="ri-j-del">🗑 Удалить</button>' +
        '<button class="ri-btn" id="ri-j-edit">✎ Изменить</button>' +
        '<button class="ri-btn ri-btn-primary" id="ri-j-add">＋ Добавить</button>' +
      '</div>' +
    '</div>';

  panelEl.querySelector('#ri-j-refresh').addEventListener('click', reloadJournal);
  panelEl.querySelector('#ri-j-search').addEventListener('input', function(e) {
    JournalState.search = e.target.value.toLowerCase();
    JournalState.page = 1;
    applyFilter();
  });
  panelEl.querySelector('#ri-j-edit').addEventListener('click', function() {
    if (JournalState.selectedId != null) openJournalDetail(JournalState.selectedId);
    else Toast.show('Выберите строку в таблице', 'warning');
  });
  panelEl.querySelector('#ri-j-add').addEventListener('click', openJournalAddModal);
  panelEl.querySelector('#ri-j-del').addEventListener('click', function() {
    if (JournalState.selectedId == null) { Toast.show('Выберите строку в таблице', 'warning'); return; }
    var id = JournalState.selectedId;
    confirmDialog('Удалить выбранное обращение из журнала?', async function() {
      await RiskApi.calllog.remove(id);
      JournalState.selectedId = null;
      Toast.show('Обращение удалено', 'success');
      reloadJournal();
    });
  });

  await reloadJournal();
}

async function reloadJournal() {
  JournalState.rows = await RiskApi.calllog.list();
  applyFilter();
}

function applyFilter() {
  var q = JournalState.search;
  JournalState.filtered = !q ? JournalState.rows.slice() : JournalState.rows.filter(function(r) {
    return (r.fname + ' ' + r.plotName + ' ' + r.fixedRisk + ' ' + r.indicator + ' ' + r.level).toLowerCase().indexOf(q) !== -1;
  });
  sortRows();
}

function sortRows() {
  var key = JournalState.sortKey, dir = JournalState.sortDir;
  JournalState.filtered.sort(function(a, b) {
    var av = a[key], bv = b[key];
    if (key === 'ddate') {
      // Невалидная дата -> Invalid Date; сравнения (<,>) с ней всегда false,
      // так что такая строка не бросает исключение, но и не сортируется
      // предсказуемо — сводим её к 0 (начало эпохи), как и в data.js:getCallLog.
      var at = new Date(av).getTime(), bt = new Date(bv).getTime();
      av = isNaN(at) ? 0 : at;
      bv = isNaN(bt) ? 0 : bt;
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
  renderJournalTable();
}

var JOURNAL_COLS = [
  { key: 'fname', label: 'Фамилия, Имя' },
  { key: 'plotName', label: 'Название участка' },
  { key: 'fixedRisk', label: 'Зафиксированный риск' },
  { key: 'indicator', label: 'Индикатор опасности' },
  { key: 'level', label: 'Уровень опасности' },
  { key: 'ddate', label: 'Дата обращения' },
  { key: 'closed', label: 'Статус' },
];

function statusBadge(closed) {
  return closed ? '<span class="ri-badge ri-badge-ok">✓ Закрыто</span>' : '<span class="ri-badge ri-badge-bad">● Открыто</span>';
}

function renderJournalTable() {
  var wrap = document.getElementById('ri-j-table');
  if (!wrap) return;
  var pag = paginate(JournalState.filtered, JournalState.page, JournalState.pageSize);
  JournalState.page = pag.page;

  var thead = '<thead><tr>' + JOURNAL_COLS.map(function(c) {
    var ind = JournalState.sortKey === c.key ? (JournalState.sortDir === 1 ? '▲' : '▼') : '';
    return '<th data-key="' + c.key + '">' + c.label + '<span class="ri-sort-ind">' + ind + '</span></th>';
  }).join('') + '</tr></thead>';

  var body = pag.pageItems.length ? pag.pageItems.map(function(r) {
    var sel = r.id === JournalState.selectedId ? ' ri-row-selected' : '';
    return '<tr class="' + sel.trim() + '" data-id="' + r.id + '">' +
      '<td>' + escHTML(r.fname) + '</td>' +
      '<td>' + escHTML(r.plotName) + '</td>' +
      '<td class="ri-td-wrap">' + escHTML(r.fixedRisk) + '</td>' +
      '<td class="ri-td-wrap">' + escHTML(r.indicator) + '</td>' +
      '<td>' + (r.level ? levelBadge(r.level) : '') + '</td>' +
      '<td class="ri-td-muted">' + formatDate(r.ddate) + '</td>' +
      '<td>' + statusBadge(r.closed) + '</td>' +
      '</tr>';
  }).join('') : '<tr class="ri-empty-row"><td colspan="' + JOURNAL_COLS.length + '">Нет обращений</td></tr>';

  wrap.innerHTML = '<table class="ri-table">' + thead + '<tbody>' + body + '</tbody></table>';

  wrap.querySelectorAll('thead th').forEach(function(th) {
    th.addEventListener('click', function() {
      var key = th.dataset.key;
      if (JournalState.sortKey === key) JournalState.sortDir *= -1;
      else { JournalState.sortKey = key; JournalState.sortDir = 1; }
      sortRows();
    });
  });
  wrap.querySelectorAll('tbody tr[data-id]').forEach(function(tr) {
    tr.addEventListener('click', function() {
      JournalState.selectedId = Number(tr.dataset.id);
      wrap.querySelectorAll('tbody tr').forEach(function(t) { t.classList.remove('ri-row-selected'); });
      tr.classList.add('ri-row-selected');
    });
    tr.addEventListener('dblclick', function() { openJournalDetail(Number(tr.dataset.id)); });
  });

  renderPager(document.getElementById('ri-j-pager'), pag.page, pag.pageCount, function(p) {
    JournalState.page = p; renderJournalTable();
  });
}

/* ---------------- Детали обращения ---------------- */

async function openJournalDetail(id) {
  var row = await RiskApi.calllog.get(id);
  if (!row) { Toast.show('Обращение не найдено', 'error'); return; }
  var plots = await RiskApi.plotNames.list();
  var allIndicators = await RiskApi.indicators.list();
  var levels = await RiskApi.levels.list();
  var fixedRisks = await RiskApi.fixedRisks.list();

  var infoPanel =
    (row.photo ? '<div class="ri-detail-photo-wrap"><img class="ri-detail-photo" src="' + escAttr(row.photoUrl) + '" alt="Фото"></div>' : '') +
    '<div class="ri-form-row">' +
      '<div class="ri-form-group"><label class="ri-form-label">Фамилия, Имя</label><input class="ri-input" id="ri-e-fname" value="' + escAttr(row.fname) + '"></div>' +
      '<div class="ri-form-group"><label class="ri-form-label">Телефон</label><input class="ri-input" id="ri-e-phone" value="' + escAttr(row.phone) + '"></div>' +
    '</div>' +
    '<div class="ri-form-row">' +
      '<div class="ri-form-group"><label class="ri-form-label">Название участка</label><div id="ri-e-plot"></div></div>' +
      '<div class="ri-form-group"><label class="ri-form-label">Уровень опасности</label><div id="ri-e-level"></div></div>' +
    '</div>' +
    '<div class="ri-form-row">' +
      '<div class="ri-form-group"><label class="ri-form-label">Индикатор опасности</label><div id="ri-e-indicator"></div></div>' +
      '<div class="ri-form-group"><label class="ri-form-label">Зафиксированный риск</label><input class="ri-input" id="ri-e-risk" value="' + escAttr(row.fixedRisk) + '" disabled></div>' +
    '</div>' +
    '<div class="ri-form-row">' +
      '<div class="ri-form-group"><label class="ri-form-label">Дата обращения</label><input type="datetime-local" class="ri-input" id="ri-e-ddate" value="' + toDatetimeLocalValue(row.ddate) + '"></div>' +
      '<div class="ri-form-group"><label class="ri-form-label">IP устройства</label><input class="ri-input" id="ri-e-ip" value="' + escAttr(row.ip) + '" disabled></div>' +
    '</div>' +
    '<div class="ri-form-row">' +
      '<div class="ri-form-group"><label class="ri-form-label">X (СК-42)</label><input type="number" step="any" class="ri-input" id="ri-e-xlocal" value="' + (row.xLocal != null ? row.xLocal : '') + '"></div>' +
      '<div class="ri-form-group"><label class="ri-form-label">Y (СК-42)</label><input type="number" step="any" class="ri-input" id="ri-e-ylocal" value="' + (row.yLocal != null ? row.yLocal : '') + '"></div>' +
    '</div>' +
    '<div class="ri-form-row">' +
      '<div class="ri-form-group"><label class="ri-form-label">X (WGS-84)</label><input type="number" step="any" class="ri-input" id="ri-e-xwgs" value="' + (row.xwgs != null ? row.xwgs : '') + '"></div>' +
      '<div class="ri-form-group"><label class="ri-form-label">Y (WGS-84)</label><input type="number" step="any" class="ri-input" id="ri-e-ywgs" value="' + (row.ywgs != null ? row.ywgs : '') + '"></div>' +
    '</div>' +
    ((row.xwgs && row.ywgs) ? '<a class="ri-map-link" href="' + escAttr('https://maps.google.com/?q=' + row.xwgs + ',' + row.ywgs) + '" target="_blank" rel="noopener">↗ Открыть на карте</a>' : '') +
    '<div class="ri-form-group"><label class="ri-form-label">Z</label><input type="number" step="any" class="ri-input" id="ri-e-z" value="' + (row.zwgs != null ? row.zwgs : '') + '"></div>' +
    '<div class="ri-form-group"><label class="ri-form-label">Комментарий заявителя</label><textarea class="ri-textarea" id="ri-e-comments">' + escHTML(row.comments) + '</textarea></div>' +
    '<div class="ri-modal-actions">' +
      '<button type="button" class="ri-btn" id="ri-e-save" disabled>💾 Сохранить изменения</button>' +
    '</div>';

  var statusPanel =
    '<div class="ri-status-row">' +
      '<span class="ri-form-label">Статус обращения:</span>' +
      (row.closed ? '<span class="ri-badge ri-badge-ok">✓ Закрыто</span>' : '<span class="ri-badge ri-badge-bad">● Открыто</span>') +
    '</div>' +
    (row.closed
      ? '<div class="ri-modal-actions"><button type="button" class="ri-btn ri-btn-outline" id="ri-j-reopen">↺ Возобновить</button></div>'
      : closeFormHTML());

  var body =
    '<div class="ri-dtabs">' +
      '<button type="button" class="ri-dtab active" data-dtab="info">Информация по обращению №' + row.id + '</button>' +
      '<button type="button" class="ri-dtab" data-dtab="status">Статус обращения</button>' +
    '</div>' +
    '<div class="ri-dtab-panel active" data-dtab-panel="info">' + infoPanel + '</div>' +
    '<div class="ri-dtab-panel" data-dtab-panel="status">' + statusPanel + '</div>';

  var overlay = buildModal('Обращение №' + row.id, body, { width: '640px' });

  overlay.querySelectorAll('.ri-dtab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      overlay.querySelectorAll('.ri-dtab').forEach(function(t) { t.classList.toggle('active', t === tab); });
      overlay.querySelectorAll('.ri-dtab-panel').forEach(function(p) { p.classList.toggle('active', p.dataset.dtabPanel === tab.dataset.dtab); });
    });
  });

  if (row.closed) {
    var reopenBtn = overlay.querySelector('#ri-j-reopen');
    reopenBtn.addEventListener('click', async function() {
      if (reopenBtn.disabled) return;
      reopenBtn.disabled = true;
      await RiskApi.calllog.reopen(id);
      Toast.show('Обращение возобновлено', 'success');
      closeModal(overlay);
      reloadJournal();
    });
  } else {
    wireCloseForm(overlay, id);
  }

  wireInfoForm(overlay, row, plots, allIndicators, levels, fixedRisks);
}

function toDatetimeLocalValue(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function fromDatetimeLocalValue(val) { return val ? val + ':00' : null; }

function wireInfoForm(overlay, row, plots, allIndicators, levels, fixedRisks) {
  var plotSel = initSearchSelect(overlay.querySelector('#ri-e-plot'),
    plots.map(function(p) { return { value: p.id, label: p.plotName }; }), { value: row.plotNameId });
  var levelSel = initSearchSelect(overlay.querySelector('#ri-e-level'),
    levels.map(function(l) { return { value: l.id, label: l.level }; }), { value: row.levelId, placeholder: '— нет —' });
  var indicatorSel = initSearchSelect(overlay.querySelector('#ri-e-indicator'),
    allIndicators.map(function(i) { return { value: i.id, label: i.indicator }; }), {
      value: row.indicatorId,
      onChange: function(indId) {
        var ind = allIndicators.find(function(i) { return String(i.id) === String(indId); });
        var risk = ind ? fixedRisks.find(function(r) { return r.id === ind.fixedRisk; }) : null;
        overlay.querySelector('#ri-e-risk').value = risk ? risk.fixedRisk : '';
        markDirty();
      },
    });

  var saveBtn = overlay.querySelector('#ri-e-save');
  function markDirty() {
    saveBtn.disabled = false;
    saveBtn.classList.add('ri-btn-primary');
  }
  overlay.querySelectorAll('#ri-e-fname, #ri-e-phone, #ri-e-ddate, #ri-e-xlocal, #ri-e-ylocal, #ri-e-xwgs, #ri-e-ywgs, #ri-e-z, #ri-e-comments')
    .forEach(function(el) { el.addEventListener('input', markDirty); });
  overlay.querySelector('#ri-e-plot').addEventListener('mousedown', function() { setTimeout(markDirty, 0); });
  overlay.querySelector('#ri-e-level').addEventListener('mousedown', function() { setTimeout(markDirty, 0); });

  saveBtn.addEventListener('click', async function() {
    if (saveBtn.disabled) return;
    saveBtn.disabled = true;
    var num = function(id) { var v = overlay.querySelector(id).value; return v === '' ? null : Number(v); };
    await RiskApi.calllog.update(row.id, {
      fname: overlay.querySelector('#ri-e-fname').value.trim(),
      phone: overlay.querySelector('#ri-e-phone').value.trim(),
      comments: overlay.querySelector('#ri-e-comments').value.trim(),
      plotName: Number(plotSel.getValue()),
      indicator: Number(indicatorSel.getValue()),
      level: levelSel.getValue() ? Number(levelSel.getValue()) : null,
      ddate: fromDatetimeLocalValue(overlay.querySelector('#ri-e-ddate').value),
      xLocal: num('#ri-e-xlocal'), yLocal: num('#ri-e-ylocal'),
      xwgs: num('#ri-e-xwgs'), ywgs: num('#ri-e-ywgs'), zwgs: num('#ri-e-z'),
    });
    Toast.show('Изменения сохранены', 'success');
    saveBtn.classList.remove('ri-btn-primary');
    reloadJournal();
  });
}

function closeFormHTML() {
  return '<div style="margin-top:6px;border-top:1px solid var(--ri-line);padding-top:14px">' +
    '<div class="ri-form-label" style="margin-bottom:8px">Закрыть обращение</div>' +
    '<div class="ri-form-group">' +
      '<label class="ri-form-label" for="ri-j-todo">Что сделано <span class="ri-req">*</span></label>' +
      '<textarea class="ri-textarea" id="ri-j-todo" placeholder="Опишите выполненные работы..."></textarea>' +
    '</div>' +
    '<div class="ri-form-group">' +
      '<label class="ri-form-label">Фото с результатом</label>' +
      '<div id="ri-j-close-dropzone"></div>' +
      '<div id="ri-j-close-preview"></div>' +
    '</div>' +
    '<div class="ri-modal-actions">' +
      '<button type="button" class="ri-btn ri-btn-primary" id="ri-j-close-submit">✓ Закрыть обращение</button>' +
    '</div>' +
  '</div>';
}

function wireCloseForm(overlay, id) {
  var photoDataUrl = '';
  initPhotoDropzone(overlay.querySelector('#ri-j-close-dropzone'), async function(file) {
    photoDataUrl = await compressImage(file);
    overlay.querySelector('#ri-j-close-preview').innerHTML =
      '<img class="ri-detail-photo" style="margin-top:8px;max-height:200px" src="' + photoDataUrl + '">';
  });
  var submitBtn = overlay.querySelector('#ri-j-close-submit');
  submitBtn.addEventListener('click', async function() {
    if (submitBtn.disabled) return;
    var todo = overlay.querySelector('#ri-j-todo').value.trim();
    if (!todo) { Toast.show('Опишите, что было сделано', 'warning'); return; }
    submitBtn.disabled = true;
    await RiskApi.calllog.close(id, { todo: todo, photo: photoDataUrl });
    Toast.show('Обращение закрыто', 'success');
    closeModal(overlay);
    reloadJournal();
  });
}

/* ---------------- Ручное добавление обращения ---------------- */

async function openJournalAddModal() {
  var plots = await RiskApi.plotNames.list();
  var risks = await RiskApi.fixedRisks.list();
  var levels = await RiskApi.levels.list();

  var body =
    '<div class="ri-form-row">' +
      '<div class="ri-form-group"><label class="ri-form-label">Фамилия, Имя <span class="ri-req">*</span></label><input class="ri-input" id="ri-a-fname"></div>' +
      '<div class="ri-form-group"><label class="ri-form-label">Телефон</label><input class="ri-input" id="ri-a-phone"></div>' +
    '</div>' +
    '<div class="ri-form-row">' +
      '<div class="ri-form-group"><label class="ri-form-label">Участок <span class="ri-req">*</span></label><div id="ri-a-plot"></div></div>' +
      '<div class="ri-form-group"><label class="ri-form-label">Уровень опасности</label><div id="ri-a-level"></div></div>' +
    '</div>' +
    '<div class="ri-form-row">' +
      '<div class="ri-form-group"><label class="ri-form-label">Зафиксированный риск <span class="ri-req">*</span></label><div id="ri-a-risk"></div></div>' +
      '<div class="ri-form-group"><label class="ri-form-label">Индикатор опасности <span class="ri-req">*</span></label><div id="ri-a-indicator"></div></div>' +
    '</div>' +
    '<div class="ri-form-group"><label class="ri-form-label">Комментарий</label><textarea class="ri-textarea" id="ri-a-comments"></textarea></div>' +
    '<div class="ri-modal-actions">' +
      '<button type="button" class="ri-btn ri-btn-outline" data-act="cancel">Отмена</button>' +
      '<button type="button" class="ri-btn ri-btn-primary" data-act="save">Добавить</button>' +
    '</div>';

  var overlay = buildModal('Новое обращение (ручной ввод)', body, { width: '560px' });

  var plotSel = initSearchSelect(overlay.querySelector('#ri-a-plot'), plots.map(function(p) { return { value: p.id, label: p.plotName }; }), {});
  var levelSel = initSearchSelect(overlay.querySelector('#ri-a-level'), levels.map(function(l) { return { value: l.id, label: l.level }; }), {});
  var riskSel, indicatorSel;
  var allIndicators = await RiskApi.indicators.list();
  indicatorSel = initSearchSelect(overlay.querySelector('#ri-a-indicator'), [], { placeholder: 'сначала выберите риск' });
  riskSel = initSearchSelect(overlay.querySelector('#ri-a-risk'), risks.map(function(r) { return { value: r.id, label: r.fixedRisk }; }), {
    onChange: function(riskId) {
      var opts = allIndicators.filter(function(i) { return String(i.fixedRisk) === String(riskId); })
        .map(function(i) { return { value: i.id, label: i.indicator }; });
      indicatorSel.setOptions(opts);
      indicatorSel.setValue('');
    },
  });

  overlay.querySelector('[data-act="cancel"]').addEventListener('click', function() { closeModal(overlay); });
  overlay.querySelector('[data-act="save"]').addEventListener('click', async function() {
    var fname = overlay.querySelector('#ri-a-fname').value.trim();
    var plotId = Number(plotSel.getValue());
    var riskId = riskSel.getValue();
    var indicatorId = Number(indicatorSel.getValue());
    if (!fname || !plotId || !riskId || !indicatorId) {
      Toast.show('Заполните обязательные поля', 'warning'); return;
    }
    await RiskApi.calllog.add({
      fname: fname, phone: overlay.querySelector('#ri-a-phone').value.trim(),
      comments: overlay.querySelector('#ri-a-comments').value.trim(),
      plotName: plotId, indicator: indicatorId, level: levelSel.getValue() ? Number(levelSel.getValue()) : null,
    });
    Toast.show('Обращение добавлено', 'success');
    closeModal(overlay);
    reloadJournal();
  });
}
