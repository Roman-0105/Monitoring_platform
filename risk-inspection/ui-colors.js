/* Настройка цветов: отдельная вкладка для конфигурации цветовых индикаторов
 * точек на карте (по уровню опасности / по типу риска), цвета линий
 * разломов и цвета полигонов доменов (см. ui-map.js). Каждое изменение
 * сохраняется сразу (RiskApi.colors / RiskApi.domains.update) — сохранять
 * отдельной кнопкой незачем, значений тут немного и правки точечные.
 */

var COLOR_SECTION_ICONS = { levels: '⚠️', risks: '🎯', fault: '🪨', domains: '🗺️' };

async function initColorsPanel(panelEl) {
  panelEl.innerHTML =
    '<div class="ri-panel-card">' +
      '<div class="ri-panel-toolbar">' +
        '<span class="ri-panel-title">Настройка цветов</span>' +
        '<button class="ri-btn ri-btn-icon" id="ri-colors-refresh" title="Обновить">🔄</button>' +
      '</div>' +
      '<div class="ri-panel-body" style="padding:20px;overflow:auto">' +
        '<div class="ri-colors-hero">' +
          '<span class="ri-colors-hero-icon">🎨</span>' +
          '<p class="ri-colors-hero-text">Эти цвета используются на вкладке «Карта»: раскраска точек обращений по уровню опасности и типу риска, линии разломов и заливка доменов. Клик по цветному квадрату открывает выбор цвета — изменения сохраняются сразу.</p>' +
        '</div>' +
        '<div class="ri-color-grid-wrap">' +
          '<div class="ri-color-section">' +
            '<div class="ri-color-section-title"><span class="ri-color-section-icon">' + COLOR_SECTION_ICONS.levels + '</span>Уровни опасности</div>' +
            '<div class="ri-color-list" id="ri-colors-levels"></div>' +
          '</div>' +
          '<div class="ri-color-section">' +
            '<div class="ri-color-section-title"><span class="ri-color-section-icon">' + COLOR_SECTION_ICONS.risks + '</span>Типы зафиксированных рисков</div>' +
            '<div class="ri-color-list" id="ri-colors-risks"></div>' +
          '</div>' +
          '<div class="ri-color-section">' +
            '<div class="ri-color-section-title"><span class="ri-color-section-icon">' + COLOR_SECTION_ICONS.fault + '</span>Разломы</div>' +
            '<div class="ri-color-list" id="ri-colors-fault"></div>' +
          '</div>' +
          '<div class="ri-color-section">' +
            '<div class="ri-color-section-title"><span class="ri-color-section-icon">' + COLOR_SECTION_ICONS.domains + '</span>Домены</div>' +
            '<div class="ri-color-list" id="ri-colors-domains"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  panelEl.querySelector('#ri-colors-refresh').addEventListener('click', reload);

  async function reload() {
    var levels = await RiskApi.levels.list();
    var levelColors = await RiskApi.colors.getLevelColorMap();
    renderColorList(panelEl.querySelector('#ri-colors-levels'), levels.map(function(l) {
      return { id: l.id, label: l.level, color: levelColors[l.id] };
    }), function(id, hex) { return RiskApi.colors.setLevelColor(id, hex); }, 'Уровни опасности ещё не заведены в справочнике');

    var risks = await RiskApi.fixedRisks.list();
    var riskColors = await RiskApi.colors.getRiskColorMap();
    renderColorList(panelEl.querySelector('#ri-colors-risks'), risks.map(function(r) {
      return { id: r.id, label: r.fixedRisk, color: riskColors[r.id] };
    }), function(id, hex) { return RiskApi.colors.setRiskColor(id, hex); }, 'Типы рисков ещё не заведены в справочнике');

    var faultColor = await RiskApi.colors.getFaultColor();
    renderColorList(panelEl.querySelector('#ri-colors-fault'), [
      { id: 'fault', label: 'Цвет линий разломов', color: faultColor },
    ], function(_id, hex) { return RiskApi.colors.setFaultColor(hex); });

    var domains = await RiskApi.domains.listAll();
    renderColorList(panelEl.querySelector('#ri-colors-domains'), domains.map(function(d) {
      return { id: d.id, label: d.name + (d.plotLabel ? ' · ' + d.plotLabel : ''), color: d.color };
    }), function(id, hex) { return RiskApi.domains.update(id, { color: hex }); }, 'Доменов пока нет');
  }

  function renderColorList(container, items, onChange, emptyHint) {
    if (!container) return;
    if (!items.length) {
      container.innerHTML = '<div class="ri-form-hint">' + escHTML(emptyHint || 'Нет записей') + '</div>';
      return;
    }
    container.innerHTML = items.map(function(item) {
      var hex = item.color || '#9ca3af';
      return '<div class="ri-color-row" data-id="' + escAttr(item.id) + '">' +
        '<span class="ri-color-swatch" style="background:' + escAttr(hex) + '">' +
          '<input type="color" class="ri-color-input" value="' + escAttr(hex) + '">' +
        '</span>' +
        '<span class="ri-color-row-label">' + escHTML(item.label) + '</span>' +
        '<span class="ri-color-row-hex">' + escHTML(hex.toUpperCase()) + '</span>' +
      '</div>';
    }).join('');
    container.querySelectorAll('.ri-color-row').forEach(function(row) {
      var idAttr = row.dataset.id;
      var id = /^\d+$/.test(idAttr) ? Number(idAttr) : idAttr;
      row.querySelector('.ri-color-input').addEventListener('change', async function(e) {
        var hex = e.target.value;
        row.querySelector('.ri-color-swatch').style.background = hex;
        row.querySelector('.ri-color-row-hex').textContent = hex.toUpperCase();
        await onChange(id, hex);
        Toast.show('Цвет сохранён', 'success');
      });
    });
  }

  await reload();
}
