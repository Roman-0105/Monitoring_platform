/* Общий CRUD-рендерер для справочников:
 * Названия участков, Зафиксированные риски, Уровни опасности, Индикаторы опасностей.
 */

function initPlotNamesPanel(panelEl) {
  initRefListPanel(panelEl, {
    title: 'Названия участков', api: RiskApi.plotNames, nameField: 'plotName', nameLabel: 'Название участка',
  });
}
function initFixedRisksPanel(panelEl) {
  initRefListPanel(panelEl, {
    title: 'Зафиксированные риски', api: RiskApi.fixedRisks, nameField: 'fixedRisk', nameLabel: 'Зафиксированный риск',
  });
}
function initLevelsPanel(panelEl) {
  initRefListPanel(panelEl, {
    title: 'Уровни опасности', api: RiskApi.levels, nameField: 'level', nameLabel: 'Уровень опасности',
    badge: true,
  });
}
function initIndicatorsPanel(panelEl) {
  initRefListPanel(panelEl, {
    title: 'Индикаторы опасностей', api: RiskApi.indicators, nameField: 'indicator', nameLabel: 'Индикатор опасности',
    extra: { field: 'fixedRisk', label: 'Зафиксированный риск', optionsApi: RiskApi.fixedRisks, optionField: 'fixedRisk' },
  });
}

async function initRefListPanel(panelEl, opts) {
  panelEl.innerHTML =
    '<div class="ri-panel-card">' +
      '<div class="ri-panel-toolbar">' +
        '<span class="ri-panel-title">' + escHTML(opts.title) + '</span>' +
        '<button class="ri-btn ri-btn-icon" data-act="refresh" title="Обновить">🔄</button>' +
      '</div>' +
      '<div class="ri-panel-body"><div class="ri-table-wrap" data-role="table"></div></div>' +
      '<div class="ri-panel-footer">' +
        '<button class="ri-btn ri-btn-danger" data-act="del">🗑 Удалить</button>' +
        '<button class="ri-btn" data-act="edit">✎ Изменить</button>' +
        '<button class="ri-btn ri-btn-primary" data-act="add">＋ Добавить</button>' +
      '</div>' +
    '</div>';

  var selectedId = null;
  var rows = [];
  var extraOptions = [];

  async function reload() {
    rows = await opts.api.list();
    if (opts.extra) extraOptions = await opts.extra.optionsApi.list();
    render();
  }

  function extraLabelFor(row) {
    if (!opts.extra) return '';
    var o = extraOptions.find(function(o) { return o.id === row[opts.extra.field]; });
    return o ? o[opts.extra.optionField] : '';
  }

  function render() {
    var wrap = panelEl.querySelector('[data-role="table"]');
    var thead = '<thead><tr><th>' + escHTML(opts.nameLabel) + '</th>' +
      (opts.extra ? '<th>' + escHTML(opts.extra.label) + '</th>' : '') + '</tr></thead>';
    var body = rows.length ? rows.map(function(r) {
      var sel = r.id === selectedId ? ' ri-row-selected' : '';
      var nameCell = opts.badge ? levelBadge(r[opts.nameField]) : escHTML(r[opts.nameField]);
      return '<tr class="' + sel.trim() + '" data-id="' + r.id + '"><td>' + nameCell + '</td>' +
        (opts.extra ? '<td class="ri-td-muted">' + escHTML(extraLabelFor(r)) + '</td>' : '') + '</tr>';
    }).join('') : '<tr class="ri-empty-row"><td colspan="2">Нет записей</td></tr>';
    wrap.innerHTML = '<table class="ri-table">' + thead + '<tbody>' + body + '</tbody></table>';
    wrap.querySelectorAll('tbody tr[data-id]').forEach(function(tr) {
      tr.addEventListener('click', function() {
        selectedId = Number(tr.dataset.id);
        wrap.querySelectorAll('tbody tr').forEach(function(t) { t.classList.remove('ri-row-selected'); });
        tr.classList.add('ri-row-selected');
      });
      tr.addEventListener('dblclick', function() { openEdit(Number(tr.dataset.id)); });
    });
  }

  function openEdit(id) {
    var row = id ? rows.find(function(r) { return r.id === id; }) : null;
    var body =
      '<div class="ri-form-group"><label class="ri-form-label">' + escHTML(opts.nameLabel) + ' <span class="ri-req">*</span></label>' +
      '<input class="ri-input" id="ri-ref-name" value="' + (row ? escAttr(row[opts.nameField]) : '') + '"></div>' +
      (opts.extra ? '<div class="ri-form-group"><label class="ri-form-label">' + escHTML(opts.extra.label) + ' <span class="ri-req">*</span></label><div id="ri-ref-extra"></div></div>' : '') +
      '<div class="ri-modal-actions">' +
        '<button type="button" class="ri-btn ri-btn-outline" data-act="cancel">Отмена</button>' +
        '<button type="button" class="ri-btn ri-btn-primary" data-act="save">' + (row ? 'Сохранить' : 'Добавить') + '</button>' +
      '</div>';
    var overlay = buildModal(row ? 'Изменить запись' : 'Новая запись', body, { width: '440px' });
    var extraSelect = null;
    if (opts.extra) {
      extraSelect = initSearchSelect(overlay.querySelector('#ri-ref-extra'),
        extraOptions.map(function(o) { return { value: o.id, label: o[opts.extra.optionField] }; }),
        { value: row ? row[opts.extra.field] : '' });
    }
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', function() { closeModal(overlay); });
    overlay.querySelector('[data-act="save"]').addEventListener('click', async function() {
      var name = overlay.querySelector('#ri-ref-name').value.trim();
      if (!name) { Toast.show('Заполните название', 'warning'); return; }
      var data = {}; data[opts.nameField] = name;
      if (opts.extra) {
        var extraVal = extraSelect.getValue();
        if (!extraVal) { Toast.show('Выберите ' + opts.extra.label.toLowerCase(), 'warning'); return; }
        data[opts.extra.field] = Number(extraVal);
      }
      if (row) await opts.api.update(row.id, data); else await opts.api.add(data);
      Toast.show(row ? 'Сохранено' : 'Добавлено', 'success');
      closeModal(overlay);
      await reload();
    });
  }

  panelEl.querySelector('[data-act="refresh"]').addEventListener('click', reload);
  panelEl.querySelector('[data-act="add"]').addEventListener('click', function() { openEdit(null); });
  panelEl.querySelector('[data-act="edit"]').addEventListener('click', function() {
    if (selectedId == null) { Toast.show('Выберите строку в таблице', 'warning'); return; }
    openEdit(selectedId);
  });
  panelEl.querySelector('[data-act="del"]').addEventListener('click', function() {
    if (selectedId == null) { Toast.show('Выберите строку в таблице', 'warning'); return; }
    var id = selectedId;
    confirmDialog('Удалить выбранную запись?', async function() {
      await opts.api.remove(id);
      selectedId = null;
      Toast.show('Удалено', 'success');
      await reload();
    });
  });

  await reload();
}
