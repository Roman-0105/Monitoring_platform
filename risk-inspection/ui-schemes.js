/* Справочники -> Схемы участков: загрузка плана участка по неделям +
 * калибровка координат (порт того же 2-точечного расчёта, что в проекте
 * "Гидрогеологический мониторинг" — см. computeBoundsFromCalibration
 * в ui-utils.js). Схема хранится по паре "участок + неделя" — каждую
 * неделю загружается новая, старые остаются в истории и доступны через
 * выбор недели, а не затираются.
 */

var SchemesState = { plots: [], activePlotId: null, activeWeekKey: null };

async function initSchemesPanel(panelEl) {
  panelEl.innerHTML =
    '<div class="ri-panel-card">' +
      '<div class="ri-panel-toolbar">' +
        '<span class="ri-panel-title">Схемы участков</span>' +
      '</div>' +
      '<div class="ri-panel-body">' +
        '<div class="ri-site-tabs" id="ri-sch-tabs"></div>' +
        '<div id="ri-sch-content" style="padding:16px"></div>' +
      '</div>' +
    '</div>';

  SchemesState.plots = await RiskApi.plotNames.list();
  if (!SchemesState.plots.length) {
    panelEl.querySelector('#ri-sch-content').innerHTML = '<p class="ri-form-hint">Сначала добавьте участок в справочнике «Названия участков».</p>';
    return;
  }
  SchemesState.activePlotId = SchemesState.plots[0].id;

  renderSchemeTabs(panelEl);
  await selectDefaultWeekAndRender(panelEl);
}

function renderSchemeTabs(panelEl) {
  var tabsEl = panelEl.querySelector('#ri-sch-tabs');
  tabsEl.innerHTML = SchemesState.plots.map(function(p) {
    var active = p.id === SchemesState.activePlotId ? ' active' : '';
    return '<button type="button" class="ri-site-tab' + active + '" data-plot="' + p.id + '">' + escHTML(p.plotName) + '</button>';
  }).join('');
  tabsEl.querySelectorAll('.ri-site-tab').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      SchemesState.activePlotId = Number(btn.dataset.plot);
      renderSchemeTabs(panelEl);
      await selectDefaultWeekAndRender(panelEl);
    });
  });
}

// При переключении участка — открываем его самую свежую загруженную
// неделю, а если схем ещё нет вовсе — текущую календарную неделю.
async function selectDefaultWeekAndRender(panelEl) {
  var latest = await RiskApi.schemes.getLatest(SchemesState.activePlotId);
  SchemesState.activeWeekKey = latest ? latest.weekKey : currentWeekKey();
  await renderSchemeContent(panelEl);
}

async function renderSchemeContent(panelEl) {
  var contentEl = panelEl.querySelector('#ri-sch-content');
  var plotId = SchemesState.activePlotId;
  var weeks = await RiskApi.schemes.listWeeks(plotId);
  var weekKey = SchemesState.activeWeekKey;
  var scheme = await RiskApi.schemes.getByPlotWeek(plotId, weekKey);

  contentEl.innerHTML =
    '<div class="ri-week-bar">' +
      '<input type="week" class="ri-input" id="ri-sch-week-input" value="' + escAttr(weekKey) + '" style="max-width:180px">' +
      '<button type="button" class="ri-btn ri-btn-sm ri-btn-outline" id="ri-sch-week-today">Текущая неделя</button>' +
      (weeks.length ? '<div class="ri-week-chips">' + weeks.map(function(w) {
        var active = w.weekKey === weekKey ? ' active' : '';
        return '<button type="button" class="ri-week-chip' + active + '" data-week="' + escAttr(w.weekKey) + '">' + formatWeekKey(w.weekKey) + '</button>';
      }).join('') + '</div>' : '') +
    '</div>' +
    (scheme
      ? '<img class="ri-scheme-preview" id="ri-sch-preview-img" src="' + scheme.image + '" alt="Схема участка">' +
        '<p class="ri-form-hint" style="margin:8px 0 16px">Загружено: ' + formatDate(scheme.uploadedAt) +
          (scheme.uploadedBy ? ' · ' + escHTML(scheme.uploadedBy) : '') + '</p>'
      : '<p class="ri-form-hint" style="margin:12px 0">Для «' + formatWeekKey(weekKey) + '» ещё не загружена схема.</p>') +
    '<div class="ri-form-group"><label class="ri-form-label">' + (scheme ? 'Заменить изображение схемы этой недели' : 'Загрузить изображение схемы на эту неделю') + '</label>' +
      '<div id="ri-sch-dropzone"></div>' +
    '</div>' +
    (scheme ? (
      '<div class="ri-form-row" style="margin-top:16px">' +
        '<div class="ri-form-group"><label class="ri-form-label">X min</label><input type="number" step="any" class="ri-input" id="ri-sch-xmin" value="' + (scheme.xMin != null ? scheme.xMin : '') + '"></div>' +
        '<div class="ri-form-group"><label class="ri-form-label">X max</label><input type="number" step="any" class="ri-input" id="ri-sch-xmax" value="' + (scheme.xMax != null ? scheme.xMax : '') + '"></div>' +
      '</div>' +
      '<div class="ri-form-row">' +
        '<div class="ri-form-group"><label class="ri-form-label">Y min</label><input type="number" step="any" class="ri-input" id="ri-sch-ymin" value="' + (scheme.yMin != null ? scheme.yMin : '') + '"></div>' +
        '<div class="ri-form-group"><label class="ri-form-label">Y max</label><input type="number" step="any" class="ri-input" id="ri-sch-ymax" value="' + (scheme.yMax != null ? scheme.yMax : '') + '"></div>' +
      '</div>' +
      '<div class="ri-modal-actions" style="justify-content:flex-start">' +
        '<button type="button" class="ri-btn ri-btn-primary" id="ri-sch-save-bounds">💾 Сохранить границы</button>' +
        '<button type="button" class="ri-btn ri-btn-outline" id="ri-sch-calibrate">📐 Откалибровать по точкам</button>' +
        '<button type="button" class="ri-btn ri-btn-danger" id="ri-sch-delete">🗑 Удалить схему этой недели</button>' +
      '</div>'
    ) : '');

  contentEl.querySelector('#ri-sch-week-input').addEventListener('change', async function(e) {
    if (!e.target.value) return;
    SchemesState.activeWeekKey = e.target.value;
    await renderSchemeContent(panelEl);
  });
  contentEl.querySelector('#ri-sch-week-today').addEventListener('click', async function() {
    SchemesState.activeWeekKey = currentWeekKey();
    await renderSchemeContent(panelEl);
  });
  contentEl.querySelectorAll('.ri-week-chip').forEach(function(chip) {
    chip.addEventListener('click', async function() {
      SchemesState.activeWeekKey = chip.dataset.week;
      await renderSchemeContent(panelEl);
    });
  });

  initPhotoDropzone(contentEl.querySelector('#ri-sch-dropzone'), async function(file) {
    var image;
    try {
      image = await compressSchemeFile(file);
    } catch (err) {
      Toast.show(err.message, 'error');
      return;
    }
    try {
      await RiskApi.schemes.upload(plotId, weekKey, image);
    } catch (err) { return; } // ошибка уже показана тостом внутри RiskApi
    Toast.show('Схема загружена', 'success');
    await renderSchemeContent(panelEl);
  }, {
    accept: 'image/*,application/pdf,.pdf,image/svg+xml,.svg',
    hint: 'Перетащите PDF/изображение схемы сюда или нажмите, чтобы выбрать файл',
    validate: function(file) {
      return file.type.indexOf('image') === 0 || file.type === 'application/pdf' ||
        /\.(pdf|svg)$/i.test(file.name);
    },
  });

  if (scheme) {
    contentEl.querySelector('#ri-sch-save-bounds').addEventListener('click', async function() {
      var num = function(id) { var v = contentEl.querySelector(id).value; return v === '' ? null : Number(v); };
      var xMin = num('#ri-sch-xmin'), xMax = num('#ri-sch-xmax'), yMin = num('#ri-sch-ymin'), yMax = num('#ri-sch-ymax');
      if (xMin == null || xMax == null || yMin == null || yMax == null || xMin >= xMax || yMin >= yMax) {
        Toast.show('Проверьте границы: min должен быть меньше max', 'warning'); return;
      }
      try {
        await RiskApi.schemes.saveBounds(plotId, weekKey, { xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax });
      } catch (err) { return; } // ошибка уже показана тостом внутри RiskApi
      Toast.show('Границы сохранены', 'success');
    });
    contentEl.querySelector('#ri-sch-calibrate').addEventListener('click', function() {
      openCalibrationModal(plotId, weekKey, scheme, function() { renderSchemeContent(panelEl); });
    });
    contentEl.querySelector('#ri-sch-delete').addEventListener('click', function() {
      var plotLabel = (SchemesState.plots.find(function(p) { return p.id === plotId; }) || {}).plotName || 'участка';
      confirmDialog('Удалить схему «' + plotLabel + '» за ' + formatWeekKey(weekKey) + '? На карте за эту неделю перестанут отображаться точки этого участка, пока не загрузите схему заново.', async function() {
        try {
          await RiskApi.schemes.remove(plotId, weekKey);
        } catch (err) { return; } // ошибка уже показана тостом внутри RiskApi
        Toast.show('Схема удалена', 'success');
        await renderSchemeContent(panelEl);
      });
    });
  }
}

/* ---------------- Инструмент калибровки: 2 точки на изображении ---------------- */

function openCalibrationModal(plotId, weekKey, scheme, onSaved) {
  var body =
    '<p class="ri-form-hint" style="margin-bottom:10px">Кликните 2 точки на схеме с известными реальными координатами (чем дальше друг от друга — тем точнее), затем укажите их X/Y.</p>' +
    '<div class="ri-cal-wrap" id="ri-cal-wrap">' +
      '<img id="ri-cal-img" src="' + scheme.image + '" draggable="false">' +
      '<div id="ri-cal-markers"></div>' +
    '</div>' +
    '<div class="ri-form-row" style="margin-top:14px">' +
      '<div class="ri-form-group"><label class="ri-form-label">Точка 1 — X</label><input type="number" step="any" class="ri-input" id="ri-cal-x1" disabled></div>' +
      '<div class="ri-form-group"><label class="ri-form-label">Точка 1 — Y</label><input type="number" step="any" class="ri-input" id="ri-cal-y1" disabled></div>' +
    '</div>' +
    '<div class="ri-form-row">' +
      '<div class="ri-form-group"><label class="ri-form-label">Точка 2 — X</label><input type="number" step="any" class="ri-input" id="ri-cal-x2" disabled></div>' +
      '<div class="ri-form-group"><label class="ri-form-label">Точка 2 — Y</label><input type="number" step="any" class="ri-input" id="ri-cal-y2" disabled></div>' +
    '</div>' +
    '<div class="ri-modal-actions">' +
      '<button type="button" class="ri-btn ri-btn-outline" id="ri-cal-reset">↺ Сбросить точки</button>' +
      '<button type="button" class="ri-btn ri-btn-primary" id="ri-cal-compute" disabled>Вычислить и сохранить границы</button>' +
    '</div>';

  var overlay = buildModal('Калибровка схемы — ' + formatWeekKey(weekKey), body, { width: '760px' });
  var img = overlay.querySelector('#ri-cal-img');
  var markersEl = overlay.querySelector('#ri-cal-markers');
  var wrap = overlay.querySelector('#ri-cal-wrap');
  var computeBtn = overlay.querySelector('#ri-cal-compute');
  var calPts = [];

  function refreshInputsEnabled() {
    ['#ri-cal-x1', '#ri-cal-y1'].forEach(function(sel) { overlay.querySelector(sel).disabled = calPts.length < 1; });
    ['#ri-cal-x2', '#ri-cal-y2'].forEach(function(sel) { overlay.querySelector(sel).disabled = calPts.length < 2; });
    computeBtn.disabled = calPts.length < 2;
  }

  function redrawMarkers() {
    markersEl.innerHTML = calPts.map(function(p, i) {
      return '<div class="ri-cal-marker" style="left:' + p.dispX + 'px;top:' + p.dispY + 'px">' + (i + 1) + '</div>';
    }).join('');
  }

  wrap.addEventListener('click', function(e) {
    if (calPts.length >= 2 || !img.complete || !img.naturalWidth) return;
    var rect = img.getBoundingClientRect();
    var dispX = e.clientX - rect.left, dispY = e.clientY - rect.top;
    if (dispX < 0 || dispY < 0 || dispX > img.offsetWidth || dispY > img.offsetHeight) return;
    var scaleR = img.naturalWidth / img.offsetWidth;
    calPts.push({ px: Math.round(dispX * scaleR), py: Math.round(dispY * scaleR), dispX: dispX, dispY: dispY, rx: null, ry: null });
    redrawMarkers();
    refreshInputsEnabled();
  });

  overlay.querySelector('#ri-cal-reset').addEventListener('click', function() {
    calPts = [];
    ['#ri-cal-x1', '#ri-cal-y1', '#ri-cal-x2', '#ri-cal-y2'].forEach(function(sel) { overlay.querySelector(sel).value = ''; });
    redrawMarkers();
    refreshInputsEnabled();
  });

  computeBtn.addEventListener('click', async function() {
    var x1 = parseFloat(overlay.querySelector('#ri-cal-x1').value);
    var y1 = parseFloat(overlay.querySelector('#ri-cal-y1').value);
    var x2 = parseFloat(overlay.querySelector('#ri-cal-x2').value);
    var y2 = parseFloat(overlay.querySelector('#ri-cal-y2').value);
    if ([x1, y1, x2, y2].some(isNaN)) { Toast.show('Заполните реальные координаты обеих точек', 'warning'); return; }
    calPts[0].rx = x1; calPts[0].ry = y1; calPts[1].rx = x2; calPts[1].ry = y2;
    try {
      var bounds = computeBoundsFromCalibration(calPts[0], calPts[1], img.naturalWidth, img.naturalHeight);
      await RiskApi.schemes.saveBounds(plotId, weekKey, bounds);
      Toast.show('Границы вычислены и сохранены', 'success');
      closeModal(overlay);
      onSaved();
    } catch (err) {
      if (!err.alreadyToasted) Toast.show(err.message, 'error');
    }
  });

  refreshInputsEnabled();
}
