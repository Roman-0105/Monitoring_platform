/* Службы -> Уведомления: маршрутизация e-mail оповещений по риску/уровню */

async function initNotificationsPanel(panelEl) {
  panelEl.innerHTML =
    '<div class="ri-panel-card">' +
      '<div class="ri-panel-toolbar">' +
        '<span class="ri-panel-title">Уведомления</span>' +
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

  async function reload() { rows = await RiskApi.notifications.list(); render(); }

  function render() {
    var wrap = panelEl.querySelector('[data-role="table"]');
    var thead = '<thead><tr><th>Зафиксированный риск</th><th>Уровень опасности</th><th>Получателей</th></tr></thead>';
    var body = rows.length ? rows.map(function(r) {
      var sel = r.id === selectedId ? ' ri-row-selected' : '';
      return '<tr class="' + sel.trim() + '" data-id="' + r.id + '">' +
        '<td class="ri-td-link">' + escHTML(r.fixedRisk) + '</td>' +
        '<td>' + (r.level ? levelBadge(r.level) : '<span class="ri-td-muted">— все уровни</span>') + '</td>' +
        '<td class="ri-td-muted">' + r.recipients.length + '</td>' +
        '</tr>';
    }).join('') : '<tr class="ri-empty-row"><td colspan="3">Нет настроенных уведомлений</td></tr>';
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

  async function openEdit(id) {
    var row = id ? rows.find(function(r) { return r.id === id; }) : null;
    var risks = await RiskApi.fixedRisks.list();
    var levels = await RiskApi.levels.list();
    var recipients = row ? row.recipients.slice() : [];

    var body =
      '<div class="ri-form-row">' +
        '<div class="ri-form-group"><label class="ri-form-label">Зафиксированный риск <span class="ri-req">*</span></label><div id="ri-n-risk"></div></div>' +
        '<div class="ri-form-group"><label class="ri-form-label">Уровень опасности</label><div id="ri-n-level"></div></div>' +
      '</div>' +
      '<div class="ri-form-group">' +
        '<label class="ri-form-label">Адрес рассылки</label>' +
        '<div class="ri-chip-list" id="ri-n-chips"></div>' +
        '<div class="ri-chip-add">' +
          '<input type="email" class="ri-input" id="ri-n-email-input" placeholder="email@rggold.kz">' +
          '<button type="button" class="ri-btn ri-btn-sm" id="ri-n-email-add">Добавить</button>' +
        '</div>' +
      '</div>' +
      '<div class="ri-modal-actions">' +
        '<button type="button" class="ri-btn ri-btn-outline" data-act="cancel">Отмена</button>' +
        '<button type="button" class="ri-btn ri-btn-primary" data-act="save">Сохранить</button>' +
      '</div>';

    var overlay = buildModal('Уведомления', body, { width: '520px' });
    var riskSel = initSearchSelect(overlay.querySelector('#ri-n-risk'), risks.map(function(r) { return { value: r.id, label: r.fixedRisk }; }), { value: row ? row.fixedRiskId : '' });
    var levelSel = initSearchSelect(overlay.querySelector('#ri-n-level'), levels.map(function(l) { return { value: l.id, label: l.level }; }), { value: row ? row.levelId : '', placeholder: 'все уровни' });

    function renderChips() {
      var chipsEl = overlay.querySelector('#ri-n-chips');
      chipsEl.innerHTML = recipients.length ? recipients.map(function(email, i) {
        return '<span class="ri-chip">' + escHTML(email) + '<button type="button" class="ri-chip-x" data-i="' + i + '">✕</button></span>';
      }).join('') : '<span class="ri-form-hint">Список пуст</span>';
      chipsEl.querySelectorAll('.ri-chip-x').forEach(function(btn) {
        btn.addEventListener('click', function() { recipients.splice(Number(btn.dataset.i), 1); renderChips(); });
      });
    }
    renderChips();

    function addEmail() {
      var input = overlay.querySelector('#ri-n-email-input');
      var val = input.value.trim();
      if (!val) return;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) { Toast.show('Некорректный e-mail', 'warning'); return; }
      if (recipients.indexOf(val) === -1) recipients.push(val);
      input.value = ''; renderChips(); input.focus();
    }
    overlay.querySelector('#ri-n-email-add').addEventListener('click', addEmail);
    overlay.querySelector('#ri-n-email-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } });

    overlay.querySelector('[data-act="cancel"]').addEventListener('click', function() { closeModal(overlay); });
    overlay.querySelector('[data-act="save"]').addEventListener('click', async function() {
      var riskId = riskSel.getValue();
      if (!riskId) { Toast.show('Выберите зафиксированный риск', 'warning'); return; }
      await RiskApi.notifications.upsert({
        id: row ? row.id : undefined,
        fixedRisk: Number(riskId),
        level: levelSel.getValue() ? Number(levelSel.getValue()) : null,
        recipients: recipients,
      });
      Toast.show('Сохранено', 'success');
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
    confirmDialog('Удалить настройку уведомления?', async function() {
      await RiskApi.notifications.remove(id);
      selectedId = null;
      Toast.show('Удалено', 'success');
      await reload();
    });
  });

  await reload();
}
