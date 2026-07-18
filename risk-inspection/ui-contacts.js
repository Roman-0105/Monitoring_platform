/* Службы -> Контакты: ответственные лица */

async function initContactsPanel(panelEl) {
  panelEl.innerHTML =
    '<div class="ri-panel-card">' +
      '<div class="ri-panel-toolbar">' +
        '<span class="ri-panel-title">Контакты</span>' +
        '<button class="ri-btn ri-btn-icon" data-act="refresh" title="Обновить">🔄</button>' +
      '</div>' +
      '<div class="ri-panel-body"><div class="ri-table-wrap" data-role="table"></div></div>' +
      '<div class="ri-panel-footer">' +
        '<button class="ri-btn ri-btn-danger" data-act="del">🗑 Удалить</button>' +
        '<button class="ri-btn" data-act="edit">✎ Изменить</button>' +
        '<button class="ri-btn ri-btn-primary" data-act="add">＋ Добавить</button>' +
      '</div>' +
    '</div>';

  var rows = [];
  var selectedId = null;

  async function reload() { rows = await RiskApi.contacts.list(); render(); }

  function render() {
    var wrap = panelEl.querySelector('[data-role="table"]');
    var thead = '<thead><tr><th>ФИО</th><th>Должность</th><th>Телефон</th><th>E-mail</th></tr></thead>';
    var body = rows.length ? rows.map(function(r) {
      var sel = r.id === selectedId ? ' ri-row-selected' : '';
      return '<tr class="' + sel.trim() + '" data-id="' + r.id + '">' +
        '<td>' + escHTML(r.fname) + '</td>' +
        '<td class="ri-td-muted">' + escHTML(r.position) + '</td>' +
        '<td class="ri-td-muted">' + escHTML(r.phone) + '</td>' +
        '<td class="ri-td-muted">' + escHTML(r.email) + '</td>' +
        '</tr>';
    }).join('') : '<tr class="ri-empty-row"><td colspan="4">Нет контактов</td></tr>';
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
      '<div class="ri-form-group"><label class="ri-form-label">ФИО <span class="ri-req">*</span></label><input class="ri-input" id="ri-c-fname" value="' + (row ? escAttr(row.fname) : '') + '"></div>' +
      '<div class="ri-form-row">' +
        '<div class="ri-form-group"><label class="ri-form-label">Должность</label><input class="ri-input" id="ri-c-position" value="' + (row ? escAttr(row.position) : '') + '"></div>' +
        '<div class="ri-form-group"><label class="ri-form-label">Телефон</label><input class="ri-input" id="ri-c-phone" value="' + (row ? escAttr(row.phone) : '') + '"></div>' +
      '</div>' +
      '<div class="ri-form-group"><label class="ri-form-label">E-mail</label><input type="email" class="ri-input" id="ri-c-email" value="' + (row ? escAttr(row.email) : '') + '"></div>' +
      '<div class="ri-modal-actions">' +
        '<button type="button" class="ri-btn ri-btn-outline" data-act="cancel">Отмена</button>' +
        '<button type="button" class="ri-btn ri-btn-primary" data-act="save">' + (row ? 'Сохранить' : 'Добавить') + '</button>' +
      '</div>';
    var overlay = buildModal(row ? 'Изменить контакт' : 'Новый контакт', body, { width: '460px' });
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', function() { closeModal(overlay); });
    overlay.querySelector('[data-act="save"]').addEventListener('click', async function() {
      var data = {
        fname: overlay.querySelector('#ri-c-fname').value.trim(),
        position: overlay.querySelector('#ri-c-position').value.trim(),
        phone: overlay.querySelector('#ri-c-phone').value.trim(),
        email: overlay.querySelector('#ri-c-email').value.trim(),
      };
      if (!data.fname) { Toast.show('Заполните ФИО', 'warning'); return; }
      if (row) await RiskApi.contacts.update(row.id, data); else await RiskApi.contacts.add(data);
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
    confirmDialog('Удалить контакт?', async function() {
      await RiskApi.contacts.remove(id);
      selectedId = null;
      Toast.show('Удалено', 'success');
      await reload();
    });
  });

  await reload();
}
