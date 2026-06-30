/**
 * report-wells.js
 * PDF-отчёт по горизонтальным скважинам
 * Формат A4, умная пагинация — без растяжки и пустых листов
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════
     КОНСТАНТЫ A4
     ══════════════════════════════════════════════════════════ */
  var PW  = 210;   // ширина A4, мм
  var PH  = 297;   // высота A4, мм
  var ML  = 20;    // левый отступ
  var MR  = 20;    // правый
  var MT  = 22;    // верхний
  var MB  = 18;    // нижний
  var CW  = PW - ML - MR;   // 170 мм — ширина контента
  var CYmax = PH - MB;       // нижняя граница контента

  /* цвета [R,G,B] */
  var C_ACCENT  = [26, 115, 232];
  var C_TEXT    = [28, 32, 40];
  var C_MUTED   = [120, 125, 135];
  var C_LINE    = [218, 220, 226];
  var C_HEAD_BG = [240, 245, 255];
  var C_GREEN   = [56, 161, 105];
  var C_YELLOW  = [214, 158, 46];
  var C_RED     = [197, 55, 55];

  var STATUS_CLR = { 'Активная': C_GREEN, 'Иссякает': C_YELLOW, 'Сухая': C_RED };

  /* ══════════════════════════════════════════════════════════
     КЛАСС PDFBuilder — умная пагинация
     ══════════════════════════════════════════════════════════ */
  function PDFBuilder(doc) {
    this.doc  = doc;
    this.page = 1;
    this.y    = MT;
  }

  /* Сброс Y на новой странице */
  PDFBuilder.prototype._resetY = function () {
    this.y = MT;
  };

  /* Добавить страницу */
  PDFBuilder.prototype.newPage = function () {
    this.doc.addPage();
    this.page++;
    this._resetY();
    this._pageDecorations();
  };

  /* Проверить: влезает ли блок высотой `need` мм?
     Если нет — новая страница. */
  PDFBuilder.prototype.need = function (h, keepWith) {
    /* keepWith: минимум места внизу чтобы не оставить заголовок-сиротку */
    keepWith = keepWith || 0;
    if (this.y + h + keepWith > CYmax) {
      this.newPage();
      return true;
    }
    return false;
  };

  /* Колонтитулы страницы */
  PDFBuilder.prototype._pageDecorations = function () {
    var doc = this.doc;
    /* Верхняя линия */
    doc.setDrawColor.apply(doc, C_LINE);
    doc.setLineWidth(0.25);
    doc.line(ML, MT - 4, PW - MR, MT - 4);
    /* Нижняя линия + номер */
    doc.line(ML, CYmax + 3, PW - MR, CYmax + 3);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor.apply(doc, C_MUTED);
    doc.text('Стр. ' + this.page, PW - MR, CYmax + 7, { align: 'right' });
  };

  /* Добавить горизонтальный разделитель */
  PDFBuilder.prototype.hr = function (gap) {
    this.y += (gap || 2);
    this.doc.setDrawColor.apply(this.doc, C_LINE);
    this.doc.setLineWidth(0.2);
    this.doc.line(ML, this.y, PW - MR, this.y);
    this.y += (gap || 3);
  };

  /* Заголовок раздела (уровень 1) */
  PDFBuilder.prototype.h1 = function (text) {
    this.need(14, 25);
    this.y += 2;
    /* Акцентная плашка слева */
    this.doc.setFillColor.apply(this.doc, C_ACCENT);
    this.doc.rect(ML, this.y, 3.5, 8, 'F');
    this.doc.setFontSize(12.5);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setTextColor.apply(this.doc, C_ACCENT);
    this.doc.text(text, ML + 6, this.y + 5.8);
    this.y += 10;
    this.hr(1);
  };

  /* Подзаголовок (уровень 2) */
  PDFBuilder.prototype.h2 = function (text) {
    this.need(10, 20);
    this.y += 2;
    this.doc.setFontSize(10);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setTextColor.apply(this.doc, C_TEXT);
    this.doc.text(text, ML, this.y);
    this.y += 7;
  };

  /* Обычный текст */
  PDFBuilder.prototype.text = function (str, opts) {
    opts = opts || {};
    var sz    = opts.size  || 8.5;
    var color = opts.color || C_TEXT;
    var bold  = opts.bold  || false;
    var align = opts.align || 'left';
    var x     = opts.x    !== undefined ? opts.x : ML;
    this.doc.setFontSize(sz);
    this.doc.setFont('helvetica', bold ? 'bold' : 'normal');
    this.doc.setTextColor.apply(this.doc, color);
    var maxW = opts.maxW || CW;
    var lines = this.doc.splitTextToSize(str, maxW);
    var lh    = sz * 0.42 + 1.0;
    this.need(lines.length * lh + 1);
    this.doc.text(lines, x, this.y, { align: align });
    this.y += lines.length * lh + (opts.gap !== undefined ? opts.gap : 1.5);
  };

  /* Добавить изображение с авто-масштабом под ширину контента.
     Никогда не делит изображение между страницами. */
  PDFBuilder.prototype.img = function (dataUrl, srcW, srcH, caption) {
    if (!dataUrl) return;
    var ratio = srcH / srcW;
    var drawW = Math.min(CW, srcW);
    var drawH = drawW * ratio;
    var maxH  = (CYmax - MT) * 0.60;   // не более 60% высоты страницы
    if (drawH > maxH) { drawW = drawW * (maxH / drawH); drawH = maxH; }
    /* Блок целиком должен влезть на одну страницу */
    this.need(drawH + (caption ? 9 : 3));
    var x = ML + (CW - drawW) / 2;
    this.doc.addImage(dataUrl, 'PNG', x, this.y, drawW, drawH);
    this.y += drawH + 1.5;
    if (caption) {
      this.doc.setFontSize(7.5);
      this.doc.setFont('helvetica', 'italic');
      this.doc.setTextColor.apply(this.doc, C_MUTED);
      this.doc.text(caption, PW / 2, this.y, { align: 'center' });
      this.y += 5.5;
    }
  };

  /* KPI-строка: горизонтальный ряд ячеек-значений */
  PDFBuilder.prototype.kpiRow = function (items) {
    this.need(14);
    var colW = CW / items.length;
    var doc  = this.doc;
    var y    = this.y;
    items.forEach(function (it, i) {
      var x = ML + i * colW;
      /* Фон */
      doc.setFillColor(247, 249, 252);
      doc.roundedRect(x + 1, y, colW - 2, 12, 1.5, 1.5, 'F');
      doc.setDrawColor.apply(doc, C_LINE);
      doc.setLineWidth(0.2);
      doc.roundedRect(x + 1, y, colW - 2, 12, 1.5, 1.5, 'D');
      /* Значение */
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor.apply(doc, it.color || C_TEXT);
      doc.text(String(it.value), x + colW / 2, y + 6, { align: 'center' });
      /* Подпись */
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor.apply(doc, C_MUTED);
      doc.text(it.label, x + colW / 2, y + 10.5, { align: 'center' });
    });
    this.y += 15;
  };

  /* Таблица через autoTable.
     Автоматически рисует колонтитулы на каждой новой странице. */
  PDFBuilder.prototype.table = function (headers, rows, opts) {
    opts = opts || {};
    var self = this;
    this.doc.autoTable({
      startY: self.y,
      margin: { left: ML, right: MR },
      head: [headers],
      body: rows,
      styles: {
        fontSize     : opts.fontSize   || 8,
        cellPadding  : opts.cellPad    || 2,
        overflow     : 'linebreak',
        lineColor    : C_LINE,
        lineWidth    : 0.2,
        textColor    : C_TEXT,
        font         : 'helvetica',
      },
      headStyles: {
        fillColor  : C_ACCENT,
        textColor  : [255, 255, 255],
        fontStyle  : 'bold',
        fontSize   : opts.fontSize || 8,
        halign     : 'left',
      },
      alternateRowStyles: {
        fillColor: [248, 250, 253],
      },
      columnStyles: opts.cols || {},
      pageBreak : 'auto',
      rowPageBreak: 'auto',
      didDrawPage: function () {
        self.page = self.doc.internal.getCurrentPageInfo().pageNumber;
        self._pageDecorations();
      },
    });
    self.y = self.doc.lastAutoTable.finalY + 4;
  };

  /* ══════════════════════════════════════════════════════════
     МОДАЛЬНОЕ ОКНО — Настройки отчёта
     ══════════════════════════════════════════════════════════ */
  function openReportModal() {
    var ex = document.getElementById('wells-report-modal');
    if (ex) { ex.style.display = 'flex'; _resetModal(); return; }

    var today     = new Date().toISOString().slice(0, 10);
    var monthAgo  = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    var modal = document.createElement('div');
    modal.id = 'wells-report-modal';
    modal.style.cssText = [
      'position:fixed;inset:0;z-index:9000',
      'display:flex;align-items:center;justify-content:center',
      'background:rgba(0,0,0,.6);backdrop-filter:blur(5px)',
    ].join(';');

    modal.innerHTML = _modalHTML(monthAgo, today);
    document.body.appendChild(modal);

    /* Закрытие */
    modal.querySelector('#rpt-close').addEventListener('click', function () { modal.style.display = 'none'; });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.style.display = 'none'; });

    /* Фильтр скважин */
    modal.querySelectorAll('.rpt-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        modal.querySelectorAll('.rpt-filter-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });

    /* Кнопка генерации */
    modal.querySelector('#rpt-build').addEventListener('click', buildReport);
  }

  function _resetModal() {
    var p = document.getElementById('rpt-progress-wrap');
    if (p) p.style.display = 'none';
    var b = document.getElementById('rpt-build');
    if (b) { b.disabled = false; b.textContent = '⬇  Сформировать PDF'; }
  }

  function _check(id, label, checked) {
    return '<label style="display:flex;align-items:center;gap:9px;padding:7px 10px;' +
           'background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);' +
           'border-radius:8px;cursor:pointer;font-size:12.5px;color:var(--txt-1)">' +
           '<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') +
           ' style="accent-color:#1a73e8;width:14px;height:14px;cursor:pointer">' +
           label + '</label>';
  }

  function _modalHTML(dateFrom, dateTo) {
    return [
      '<div style="background:var(--bg-card,#1e2535);border-radius:16px;padding:28px 28px 24px;',
           'width:480px;max-width:95vw;max-height:90vh;overflow-y:auto;',
           'box-shadow:0 32px 80px rgba(0,0,0,.7);border:1px solid rgba(255,255,255,.09)">',

        /* Шапка */
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px">',
          '<div>',
            '<div style="font-size:17px;font-weight:700;color:var(--txt-1)">Отчёт по скважинам</div>',
            '<div style="font-size:11.5px;color:var(--txt-3);margin-top:3px">Формат PDF · А4 · Горизонтальные скважины</div>',
          '</div>',
          '<button id="rpt-close" style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);',
                  'color:var(--txt-2);border-radius:8px;padding:4px 11px;cursor:pointer;font-size:17px;line-height:1">✕</button>',
        '</div>',

        /* Период */
        '<div style="margin-bottom:18px">',
          '<div style="font-size:10.5px;font-weight:600;color:var(--txt-3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Период</div>',
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">',
            '<div>',
              '<div style="font-size:11px;color:var(--txt-3);margin-bottom:4px">С</div>',
              '<input id="rpt-from" type="date" value="' + dateFrom + '" style="' + _inputStyle() + '">',
            '</div>',
            '<div>',
              '<div style="font-size:11px;color:var(--txt-3);margin-bottom:4px">По</div>',
              '<input id="rpt-to" type="date" value="' + dateTo + '" style="' + _inputStyle() + '">',
            '</div>',
          '</div>',
        '</div>',

        /* Разделы */
        '<div style="margin-bottom:18px">',
          '<div style="font-size:10.5px;font-weight:600;color:var(--txt-3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Разделы</div>',
          '<div style="display:flex;flex-direction:column;gap:5px">',
            _check('rpt-c-summary',  'Сводная таблица скважин',   true),
            _check('rpt-c-map',      'Схема расположения',         true),
            _check('rpt-c-passport', 'Паспорта скважин',           true),
            _check('rpt-c-meas',     'Таблица замеров дебита',     true),
            _check('rpt-c-chart',    'Графики дебита',             true),
          '</div>',
        '</div>',

        /* Скважины */
        '<div style="margin-bottom:22px">',
          '<div style="font-size:10.5px;font-weight:600;color:var(--txt-3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Скважины</div>',
          '<div style="display:flex;gap:8px">',
            '<button class="rpt-filter-btn active" data-f="all" style="' + _filterBtnStyle(true) + '">Все</button>',
            '<button class="rpt-filter-btn" data-f="sel" style="' + _filterBtnStyle(false) + '">Только выбранная</button>',
          '</div>',
        '</div>',

        /* Прогресс */
        '<div id="rpt-progress-wrap" style="display:none;margin-bottom:12px">',
          '<div id="rpt-progress-text" style="font-size:11.5px;color:var(--txt-3);margin-bottom:5px">Подготовка...</div>',
          '<div style="height:3px;background:rgba(255,255,255,.08);border-radius:2px">',
            '<div id="rpt-progress-bar" style="height:3px;background:#1a73e8;border-radius:2px;width:0%;transition:width .3s ease"></div>',
          '</div>',
        '</div>',

        /* Кнопка */
        '<button id="rpt-build" style="width:100%;padding:12px;border:none;border-radius:10px;',
                'background:linear-gradient(135deg,#1a73e8 0%,#0d5fc8 100%);color:#fff;',
                'font-size:14px;font-weight:600;cursor:pointer;letter-spacing:.02em;',
                'box-shadow:0 4px 16px rgba(26,115,232,.35)">',
          '⬇  Сформировать PDF',
        '</button>',

      '</div>',
    ].join('');
  }

  function _inputStyle() {
    return 'width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);' +
           'border:1px solid rgba(255,255,255,.12);color:var(--txt-1);' +
           'border-radius:8px;padding:8px 10px;font-size:13px';
  }

  function _filterBtnStyle(active) {
    return 'padding:6px 16px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:500;border:1px solid;' +
      (active
        ? 'background:rgba(26,115,232,.18);border-color:rgba(26,115,232,.5);color:#6ea8fe'
        : 'background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.12);color:var(--txt-2)');
  }

  /* ══════════════════════════════════════════════════════════
     ПРОГРЕСС
     ══════════════════════════════════════════════════════════ */
  function setProgress(text, pct) {
    var wrap = document.getElementById('rpt-progress-wrap');
    var bar  = document.getElementById('rpt-progress-bar');
    var txt  = document.getElementById('rpt-progress-text');
    if (wrap) wrap.style.display = '';
    if (bar)  bar.style.width    = pct + '%';
    if (txt)  txt.textContent    = text;
  }

  /* ══════════════════════════════════════════════════════════
     ТОЧКА ВХОДА — buildReport
     ══════════════════════════════════════════════════════════ */
  function buildReport() {
    var btn = document.getElementById('rpt-build');
    if (btn) { btn.disabled = true; btn.textContent = 'Формирование...'; }

    var opts = {
      dateFrom   : (document.getElementById('rpt-from')       || {}).value || '',
      dateTo     : (document.getElementById('rpt-to')         || {}).value || '',
      secSummary : _chk('rpt-c-summary'),
      secMap     : _chk('rpt-c-map'),
      secPassport: _chk('rpt-c-passport'),
      secMeas    : _chk('rpt-c-meas'),
      secChart   : _chk('rpt-c-chart'),
    };

    var activeFilter = document.querySelector('.rpt-filter-btn.active');
    var onlySel = activeFilter && activeFilter.dataset.f === 'sel';

    var wells = (WellsState.list || []).filter(function (w) { return w.wellType !== 'piezometric'; });
    if (onlySel && WellsState.selectedId) {
      wells = wells.filter(function (w) { return w.id === WellsState.selectedId; });
    }

    setProgress('Загрузка библиотек...', 5);
    _loadLibs(function (jsPDF) {
      setProgress('Сборка PDF...', 12);
      setTimeout(function () {
        _assemble(jsPDF, wells, opts, function () {
          if (btn) { btn.disabled = false; btn.textContent = '⬇  Сформировать PDF'; }
          var modal = document.getElementById('wells-report-modal');
          if (modal) modal.style.display = 'none';
        });
      }, 60);
    });
  }

  function _chk(id) {
    var el = document.getElementById(id);
    return el ? el.checked : false;
  }

  /* ══════════════════════════════════════════════════════════
     СБОРКА PDF
     ══════════════════════════════════════════════════════════ */
  function _assemble(jsPDF, wells, opts, done) {
    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var b   = new PDFBuilder(doc);

    var quarry    = (wells[0] && (wells[0].quarry || wells[0].pit)) || 'Карьер';
    var dateLabel = _fmtDate(opts.dateFrom) + ' — ' + _fmtDate(opts.dateTo);
    var genDate   = new Date().toLocaleDateString('ru-RU', { day:'2-digit', month:'long', year:'numeric' });
    var secIdx    = 1;

    /* ── Титульная страница ─────────────────────────────── */
    setProgress('Титульный лист...', 18);
    _titlePage(doc, quarry, dateLabel, genDate, wells.length);

    b.newPage();
    b._pageDecorations();

    /* ── Раздел 1: Сводная таблица ──────────────────────── */
    if (opts.secSummary) {
      setProgress('Сводная таблица...', 28);
      _sectionSummary(b, wells, secIdx++);
    }

    /* ── Раздел 2: Схема расположения ───────────────────── */
    if (opts.secMap) {
      setProgress('Схема расположения...', 38);
      _captureSvg(function (imgData, iw, ih) {
        _sectionMap(b, imgData, iw, ih, secIdx++);
        _sectionWells(b, doc, wells, opts, secIdx, dateLabel, done);
      });
    } else {
      _sectionWells(b, doc, wells, opts, secIdx, dateLabel, done);
    }
  }

  /* ══════════════════════════════════════════════════════════
     ТИТУЛЬНАЯ СТРАНИЦА
     ══════════════════════════════════════════════════════════ */
  function _titlePage(doc, quarry, dateLabel, genDate, cnt) {
    /* Верхняя шапка */
    doc.setFillColor.apply(doc, C_ACCENT);
    doc.rect(0, 0, PW, 12, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(255, 255, 255);
    doc.text('ГИДРОГЕОЛОГИЧЕСКАЯ ПЛАТФОРМА МОНИТОРИНГА', ML, 7.5);
    doc.text(new Date().getFullYear().toString(), PW - MR, 7.5, { align: 'right' });

    /* Центральный блок */
    var bx = ML, by = 68, bw = CW, bh = 100;
    doc.setFillColor(245, 248, 255);
    doc.roundedRect(bx, by, bw, bh, 5, 5, 'F');
    doc.setDrawColor.apply(doc, C_LINE);
    doc.setLineWidth(0.4);
    doc.roundedRect(bx, by, bw, bh, 5, 5, 'D');

    /* Акцентная полоса сверху блока */
    doc.setFillColor.apply(doc, C_ACCENT);
    doc.roundedRect(bx, by, bw, 5, 5, 5, 'F');
    doc.rect(bx, by + 2.5, bw, 2.5, 'F');

    var cy = by + 18;
    /* Заголовок */
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor.apply(doc, C_ACCENT);
    doc.text('ОТЧЁТ', PW / 2, cy, { align: 'center' });

    doc.setFontSize(13);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor.apply(doc, C_TEXT);
    doc.text('Мониторинг горизонтальных скважин', PW / 2, cy + 11, { align: 'center' });

    doc.setFontSize(10.5);
    doc.setTextColor.apply(doc, C_MUTED);
    doc.text(quarry, PW / 2, cy + 21, { align: 'center' });

    /* Разделитель */
    doc.setDrawColor.apply(doc, C_LINE);
    doc.setLineWidth(0.4);
    doc.line(bx + 22, cy + 30, bx + bw - 22, cy + 30);

    /* Период */
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor.apply(doc, C_TEXT);
    doc.text('Период: ' + dateLabel, PW / 2, cy + 42, { align: 'center' });

    /* Кол-во скважин */
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor.apply(doc, C_MUTED);
    doc.text('Скважин в отчёте: ' + cnt, PW / 2, cy + 53, { align: 'center' });

    /* Подвал */
    doc.setFontSize(8);
    doc.setTextColor.apply(doc, C_MUTED);
    doc.text('Дата формирования: ' + genDate, PW / 2, PH - 24, { align: 'center' });

    /* Нижняя шапка */
    doc.setFillColor.apply(doc, C_ACCENT);
    doc.rect(0, PH - 10, PW, 10, 'F');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('КОНФИДЕНЦИАЛЬНО · Только для служебного пользования', PW / 2, PH - 4, { align: 'center' });
  }

  /* ══════════════════════════════════════════════════════════
     РАЗДЕЛ: СВОДНАЯ ТАБЛИЦА
     ══════════════════════════════════════════════════════════ */
  function _sectionSummary(b, wells, n) {
    b.h1(n + '. Сводная таблица скважин');

    var active = wells.filter(function (w) { return w.status === 'Активная'; }).length;
    var drying = wells.filter(function (w) { return w.status === 'Иссякает'; }).length;
    var dry    = wells.filter(function (w) { return w.status === 'Сухая'; }).length;

    b.kpiRow([
      { label: 'Всего скважин', value: wells.length, color: C_ACCENT },
      { label: 'Активных',      value: active,       color: C_GREEN  },
      { label: 'Иссякает',      value: drying,       color: C_YELLOW },
      { label: 'Сухих',         value: dry,          color: C_RED    },
    ]);

    b.y += 2;

    var headers = ['Название', 'Тип', 'Статус', 'Глубина', 'Азимут', 'Домен', 'Дата бурения', 'Дебит, м³/ч'];
    var rows = wells.map(function (w) {
      return [
        w.name || '—',
        w.wellType === 'piezometric' ? 'Пьезо' : 'Дренажная',
        w.status || '—',
        w.depth    != null ? w.depth    + ' м'  : '—',
        w.azimuth  != null ? w.azimuth  + '°'   : '—',
        w.domain   != null ? String(w.domain)    : '—',
        w.drillingDate ? _fmtDate(w.drillingDate) : '—',
        w.drillingFlowRate != null ? String(w.drillingFlowRate) : '—',
      ];
    });

    b.table(headers, rows, {
      fontSize : 7.5,
      cellPad  : 1.8,
      cols: {
        0: { fontStyle: 'bold', cellWidth: 26 },
        1: { cellWidth: 22 },
        2: { cellWidth: 22 },
        3: { cellWidth: 20, halign: 'right' },
        4: { cellWidth: 18, halign: 'right' },
        5: { cellWidth: 16, halign: 'center' },
        7: { cellWidth: 22, halign: 'right' },
      },
    });
  }

  /* ══════════════════════════════════════════════════════════
     РАЗДЕЛ: СХЕМА РАСПОЛОЖЕНИЯ
     ══════════════════════════════════════════════════════════ */
  function _sectionMap(b, imgData, iw, ih, n) {
    b.need(60, 40);
    b.h1(n + '. Схема расположения скважин');
    if (imgData) {
      b.img(imgData, iw, ih, 'Рис. 1 — Схема горизонтальных скважин карьера');
    } else {
      b.text('Схема недоступна', { color: C_MUTED });
    }
  }

  /* ══════════════════════════════════════════════════════════
     РАЗДЕЛ: ДАННЫЕ ПО СКВАЖИНАМ (поочерёдно)
     ══════════════════════════════════════════════════════════ */
  function _sectionWells(b, doc, wells, opts, secIdx, dateLabel, done) {
    if (!opts.secPassport && !opts.secMeas && !opts.secChart) {
      return _save(doc, done);
    }

    /* Собираем все нужные замеры сначала, потом рисуем */
    var toLoad = wells.filter(function (w) { return !WellsState.measurements[w.id]; });
    var loaded = 0;

    if (!toLoad.length) {
      _drawWellsSection(b, doc, wells, opts, secIdx, done);
      return;
    }

    setProgress('Загрузка замеров (' + toLoad.length + ' скважин)...', 50);
    toLoad.forEach(function (w) {
      Api.getWellMeasurements(w.id).then(function (list) {
        WellsState.measurements[w.id] = list;
        loaded++;
        setProgress('Загрузка замеров (' + loaded + '/' + toLoad.length + ')...', 50 + Math.round(loaded / toLoad.length * 15));
        if (loaded === toLoad.length) {
          _drawWellsSection(b, doc, wells, opts, secIdx, done);
        }
      }).catch(function () {
        WellsState.measurements[w.id] = [];
        loaded++;
        if (loaded === toLoad.length) {
          _drawWellsSection(b, doc, wells, opts, secIdx, done);
        }
      });
    });
  }

  function _drawWellsSection(b, doc, wells, opts, secIdx, done) {
    setProgress('Формирование страниц...', 68);
    b.h1(secIdx + '. Данные по скважинам');

    var idx = 0;
    function nextWell() {
      if (idx >= wells.length) {
        setProgress('Готово!', 100);
        return _save(doc, done);
      }
      var w   = wells[idx++];
      var pct = 68 + Math.round(idx / wells.length * 28);
      setProgress('Скважина ' + (w.name || idx) + ' (' + idx + '/' + wells.length + ')...', pct);

      /* ── Шапка скважины ── */
      b.need(14, 35);
      b.y += 3;
      var sc = STATUS_CLR[w.status] || C_MUTED;
      doc.setFillColor.apply(doc, sc);
      doc.rect(ML, b.y, CW, 8, 'F');
      doc.setFontSize(10.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text((w.name || '—') + '  ·  ' + (w.status || ''), ML + 4, b.y + 5.5);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(w.wellType === 'piezometric' ? 'Пьезометрическая' : 'Дренажная', PW - MR - 4, b.y + 5.5, { align: 'right' });
      b.y += 11;

      /* ── Паспорт ── */
      if (opts.secPassport) {
        var passRows = [
          ['Карьер',        w.quarry || w.pit || '—',  'Участок',           w.plot || '—'],
          ['Глубина',       w.depth    != null ? w.depth + ' м'  : '—',
           'Азимут',        w.azimuth  != null ? w.azimuth + '°' : '—'],
          ['Диаметр',       w.diameter != null ? w.diameter + ' мм' : '—',
           'Домен',         w.domain   != null ? String(w.domain)   : '—'],
          ['Дата бурения',  w.drillingDate ? _fmtDate(w.drillingDate) : '—',
           'Дебит (бур.)',  w.drillingFlowRate != null ? w.drillingFlowRate + ' м³/ч' : '—'],
        ];
        if (w.x != null) passRows.push(['X (местн.)', _n(w.x), 'Y (местн.)', _n(w.y)]);
        if (w.lat != null) passRows.push(['Широта', _n(w.lat, 6) + '°N', 'Долгота', _n(w.lon, 6) + '°E']);

        doc.autoTable({
          startY: b.y,
          margin: { left: ML, right: MR },
          body: passRows,
          styles: {
            fontSize: 8, cellPadding: 2, textColor: C_TEXT,
            lineColor: C_LINE, lineWidth: 0.18, font: 'helvetica',
          },
          columnStyles: {
            0: { fontStyle: 'bold', fillColor: C_HEAD_BG, cellWidth: 38 },
            1: { cellWidth: 47 },
            2: { fontStyle: 'bold', fillColor: C_HEAD_BG, cellWidth: 38 },
            3: { cellWidth: 47 },
          },
          didDrawPage: function () {
            b.page = doc.internal.getCurrentPageInfo().pageNumber;
            b._pageDecorations();
          },
        });
        b.y = doc.lastAutoTable.finalY + 5;
      }

      /* ── Замеры ── */
      var allMeas  = WellsState.measurements[w.id] || [];
      var filtered = _filterPeriod(allMeas, opts.dateFrom, opts.dateTo);

      if (opts.secMeas) {
        b.need(18, 24);
        if (filtered.length) {
          b.h2('Замеры дебита · ' + _fmtDate(opts.dateFrom) + ' — ' + _fmtDate(opts.dateTo));
          var sorted = filtered.slice().sort(function (a, b) {
            return (b.measurementDate || '') > (a.measurementDate || '') ? 1 : -1;
          });
          var mHeaders = ['Дата замера', 'Дебит, м³/ч', 'Сотрудник', 'Примечание'];
          var mRows = sorted.map(function (m) {
            return [
              m.measurementDate ? _fmtDate(m.measurementDate) : '—',
              m.flowRate != null ? String(m.flowRate) : '—',
              m.worker || '—',
              m.note   || '',
            ];
          });
          b.table(mHeaders, mRows, {
            fontSize: 8,
            cols: {
              0: { cellWidth: 36 },
              1: { cellWidth: 30, halign: 'right' },
              2: { cellWidth: 44 },
            },
          });
        } else {
          b.text('Замеры за выбранный период отсутствуют', { color: C_MUTED, size: 8 });
          b.y += 3;
        }
      }

      /* ── График ── */
      if (opts.secChart && filtered.length >= 2) {
        _chartToImg(w, filtered, function (img, cw, ch) {
          if (img) {
            b.need(62);
            b.h2('График дебита');
            b.img(img, cw, ch, 'Динамика дебита (м³/ч) · ' + (w.name || ''));
          }
          b.y += 5;
          nextWell();
        });
      } else {
        b.y += 5;
        nextWell();
      }
    }
    nextWell();
  }

  /* ══════════════════════════════════════════════════════════
     ЗАХВАТ SVG-КАРТЫ
     ══════════════════════════════════════════════════════════ */
  function _captureSvg(cb) {
    var svgEl = document.getElementById('wells-map-svg');
    if (!svgEl) { cb(null, 0, 0); return; }
    try {
      var r   = svgEl.getBoundingClientRect();
      var sw  = r.width  || 800;
      var sh  = r.height || 500;
      var xml = new XMLSerializer().serializeToString(svgEl);
      /* Вставляем белый фон */
      xml = xml.replace('<svg ', '<svg style="background:#f0f0f0" ');
      var blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      var url  = URL.createObjectURL(blob);
      var img  = new Image();
      img.onload = function () {
        var scale  = 2;
        var canvas = document.createElement('canvas');
        canvas.width  = sw * scale;
        canvas.height = sh * scale;
        var ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, sw, sh);
        ctx.drawImage(img, 0, 0, sw, sh);
        URL.revokeObjectURL(url);
        cb(canvas.toDataURL('image/png'), sw, sh);
      };
      img.onerror = function () { URL.revokeObjectURL(url); cb(null, 0, 0); };
      img.src = url;
    } catch (e) { cb(null, 0, 0); }
  }

  /* ══════════════════════════════════════════════════════════
     РЕНДЕР ГРАФИКА В CANVAS → dataURL
     ══════════════════════════════════════════════════════════ */
  function _chartToImg(well, meas, cb) {
    if (typeof Chart === 'undefined') { cb(null); return; }
    try {
      var sorted = meas.slice().sort(function (a, b) {
        return (a.measurementDate || '') < (b.measurementDate || '') ? -1 : 1;
      });
      var labels = sorted.map(function (m) { return _fmtDateShort(m.measurementDate); });
      var values = sorted.map(function (m) { return parseFloat(m.flowRate) || 0; });
      var color  = STATUS_CLR[well.status] || C_ACCENT;
      var cssClr = 'rgb(' + color.join(',') + ')';

      var canvas = document.createElement('canvas');
      canvas.width  = 900;
      canvas.height = 300;
      /* Рендерим вне DOM (но Chart.js требует добавления) */
      canvas.style.position = 'fixed';
      canvas.style.left     = '-9999px';
      document.body.appendChild(canvas);

      var chart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            data: values,
            borderColor     : cssClr,
            backgroundColor : cssClr.replace('rgb', 'rgba').replace(')', ',.12)'),
            borderWidth     : 2.5,
            pointRadius     : 4,
            pointBackgroundColor: cssClr,
            fill            : true,
            tension         : 0.35,
          }],
        },
        options: {
          animation  : false,
          responsive : false,
          plugins    : { legend: { display: false } },
          scales: {
            x: {
              grid  : { color: 'rgba(0,0,0,.06)' },
              ticks : { font: { size: 11 }, maxRotation: 45, color: '#555' },
            },
            y: {
              grid        : { color: 'rgba(0,0,0,.06)' },
              ticks       : { font: { size: 11 }, color: '#555' },
              beginAtZero : false,
              title       : { display: true, text: 'м³/ч', font: { size: 11 }, color: '#555' },
            },
          },
        },
      });

      setTimeout(function () {
        var dataUrl = canvas.toDataURL('image/png');
        chart.destroy();
        document.body.removeChild(canvas);
        cb(dataUrl, 900, 300);
      }, 250);
    } catch (e) {
      console.warn('Chart render error:', e);
      cb(null);
    }
  }

  /* ══════════════════════════════════════════════════════════
     ЗАГРУЗКА БИБЛИОТЕК
     ══════════════════════════════════════════════════════════ */
  function _loadLibs(cb) {
    var jsPDFCls = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (jsPDFCls && jsPDFCls.prototype && typeof jsPDFCls.prototype.autoTable === 'function') {
      return cb(jsPDFCls);
    }
    _loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', function () {
      _loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js', function () {
        var cls = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
        cb(cls);
      });
    });
  }

  function _loadScript(src, cb) {
    var s = document.createElement('script');
    s.src = src; s.onload = cb;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════
     ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
     ══════════════════════════════════════════════════════════ */
  function _filterPeriod(meas, from, to) {
    return meas.filter(function (m) {
      var d = (m.measurementDate || '').slice(0, 10);
      if (from && d < from) return false;
      if (to   && d > to)   return false;
      return true;
    });
  }

  function _fmtDate(s) {
    if (!s) return '—';
    try { return new Date(s).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' }); }
    catch (e) { return s; }
  }

  function _fmtDateShort(s) {
    if (!s) return '';
    try { return new Date(s).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit' }); }
    catch (e) { return s; }
  }

  function _n(v, dec) {
    if (v == null) return '—';
    return typeof v === 'number' ? v.toFixed(dec !== undefined ? dec : 2) : String(v);
  }

  function _save(doc, done) {
    var now  = new Date();
    var name = 'report-wells-' +
               now.getFullYear() + '-' +
               String(now.getMonth() + 1).padStart(2, '0') + '-' +
               String(now.getDate()).padStart(2, '0') + '.pdf';
    doc.save(name);
    if (done) done();
  }

  /* ══════════════════════════════════════════════════════════
     ПУБЛИЧНЫЙ API
     ══════════════════════════════════════════════════════════ */
  window.WellsReport = { open: openReportModal };

})();
