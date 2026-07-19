/* Настройка цветов: отдельная вкладка для конфигурации цветовых индикаторов
 * точек на карте (по уровню опасности / по типу риска), цвета линий
 * разломов и цвета полигонов доменов (см. ui-map.js). Каждое изменение
 * сохраняется сразу (RiskApi.colors / RiskApi.domains.update) — сохранять
 * отдельной кнопкой незачем, значений тут немного и правки точечные.
 */

async function initColorsPanel(panelEl) {
  panelEl.innerHTML =
    '<div class="ri-panel-card">' +
      '<div class="ri-panel-toolbar">' +
        '<span class="ri-panel-title">Настройка цветов</span>' +
        '<button class="ri-btn ri-btn-icon" id="ri-colors-refresh" title="Обновить">🔄</button>' +
      '</div>' +
      '<div class="ri-panel-body" style="padding:16px;overflow:auto">' +
        '<p class="ri-form-hint" style="margin:0 0 16px">Эти цвета используются на вкладке «Карта»: раскраска точек обращений по уровню опасности / типу риска, цвет линий разломов и заливка доменов.</p>' +
        '<div class="ri-color-section"><div class="ri-color-section-title">Уровни опасности</div><div class="ri-color-list" id="ri-colors-levels"></div></div>' +
        '<div class="ri-color-section"><div class="ri-color-section-title">Типы зафиксированных рисков</div><div class="ri-color-list" id="ri-colors-risks"></div></div>' +
        '<div class="ri-color-section"><div class="ri-color-section-title">Разломы</div><div class="ri-color-list" id="ri-colors-fault"></div></div>' +
        '<div class="ri-color-section"><div class="ri-color-section-title">Домены</div><div class="ri-color-list" id="ri-colors-domains"></div></div>' +
      '</div>' +
    '</div>';

  panelEl.querySelector('#ri-colors-refresh').addEventListener('click', reload);

  async function reload() {
    var levels = await RiskApi.levels.list();
    var levelColors = await RiskApi.colors.getLevelColorMap();
    renderColorList(panelEl.querySelector('#ri-colors-levels'), levels.map(function(l) {
      return { id: l.id, label: l.level, color: levelColors[l.id] };
    }), function(id, hex) { return RiskApi.colors.setLevelColor(id, hex); });

    var risks = await RiskApi.fixedRisks.list();
    var riskColors = await RiskApi.colors.getRiskColorMap();
    renderColorList(panelEl.querySelector('#ri-colors-risks'), risks.map(function(r) {
      return { id: r.id, label: r.fixedRisk, color: riskColors[r.id] };
    }), function(id, hex) { return RiskApi.colors.setRiskColor(id, hex); });

    var faultColor = await RiskApi.colors.getFaultColor();
    renderColorList(panelEl.querySelector('#ri-colors-fault'), [
      { id: 'fault', label: 'Цвет линий разломов', color: faultColor },
    ], function(_id, hex) { return RiskApi.colors.setFaultColor(hex); });

    var domains = await RiskApi.domains.listAll();
    renderColorList(panelEl.querySelector('#ri-colors-domains'), domains.map(function(d) {
      return { id: d.id, label: d.name + (d.plotLabel ? ' · ' + d.plotLabel : ''), color: d.color };
    }), function(id, hex) { return RiskApi.domains.update(id, { color: hex }); }, 'Доменов пока нет — создайте их на вкладке «Карта» (кнопка 🧩 «Слои»)');
  }

  function renderColorList(container, items, onChange, emptyHint) {
    if (!container) return;
    if (!items.length) {
      container.innerHTML = '<div class="ri-form-hint">' + escHTML(emptyHint || 'Нет записей') + '</div>';
      return;
    }
    container.innerHTML = items.map(function(item) {
      return '<div class="ri-color-row" data-id="' + escAttr(item.id) + '">' +
        '<input type="color" class="ri-color-input" value="' + escAttr(item.color || '#9ca3af') + '">' +
        '<span class="ri-color-row-label">' + escHTML(item.label) + '</span>' +
      '</div>';
    }).join('');
    container.querySelectorAll('.ri-color-row').forEach(function(row) {
      var idAttr = row.dataset.id;
      var id = /^\d+$/.test(idAttr) ? Number(idAttr) : idAttr;
      row.querySelector('.ri-color-input').addEventListener('change', async function(e) {
        await onChange(id, e.target.value);
        Toast.show('Цвет сохранён', 'success');
      });
    });
  }

  await reload();
}
