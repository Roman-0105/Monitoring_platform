/**
 * ui-print.js — печать карточки точки.
 * Открывает новое окно с print-friendly HTML, загружает историю и вызывает window.print().
 */

function printPointCard(pointId) {
  var p = Points.getById(pointId);
  if (!p) { Toast.show('Точка не найдена', 'error'); return; }

  var tid = Toast.progress('print', 'Подготовка к печати...');

  // Загружаем историю замеров
  Api.getHistory(p.pointNumber).then(function(history) {
    Toast.hide('print');
    history = history || [];
    // Нормализуем даты
    history.forEach(function(r) {
      if (r.monitoringDate) {
        r.monitoringDate = _printNormalizeDate(r.monitoringDate);
      }
    });
    history.sort(function(a,b) {
      return a.monitoringDate < b.monitoringDate ? -1 : 1;
    });
    _openPrintWindow(p, history);
  }).catch(function() {
    Toast.hide('print');
    _openPrintWindow(p, []);
  });
}

// ── Нормализация даты → YYYY-MM-DD ────────────────────────
function _printNormalizeDate(raw) {
  if (!raw) return '';
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return '';
    return raw.getFullYear() + '-' +
           String(raw.getMonth()+1).padStart(2,'0') + '-' +
           String(raw.getDate()).padStart(2,'0');
  }
  var s = String(raw).trim();
  var dot = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
  if (dot) return dot[3]+'-'+dot[2].padStart(2,'0')+'-'+dot[1].padStart(2,'0');
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  var dt = new Date(s);
  if (!isNaN(dt.getTime()))
    return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
  return '';
}

function _printFmtDate(iso) {
  if (!iso || iso.length < 10) return iso || '—';
  return iso.slice(8,10)+'.'+iso.slice(5,7)+'.'+iso.slice(0,4);
}

function _printFmtDateTime(raw) {
  if (!raw) return '—';
  try {
    var d = new Date(raw);
    if (isNaN(d.getTime())) return String(raw);
    return d.toLocaleString('ru-RU');
  } catch(e) { return String(raw); }
}

// ── Открываем окно печати ────────────────────────────────
function _openPrintWindow(p, history) {
  var STATUS_COLORS = (typeof MapModule !== 'undefined') ? MapModule.STATUS_COLORS : {
    'Новая':'#1a73e8','Активная':'#34a853','Иссякает':'#f9ab00',
    'Пересохла':'#ea4335','Паводковая':'#7c3aed','Перелив':'#0891b2'
  };

  var sc       = STATUS_COLORS[p.status] || '#888';
  var monDate  = _printFmtDate(_printNormalizeDate(p.monitoringDate));
  var hasPhoto = p.photoUrls && p.photoUrls[0];
  var photoUrl = hasPhoto ? p.photoUrls[0] : '';

  // ── Таблица истории ──────────────────────────────────────
  function buildHistoryTable() {
    if (!history.length) {
      return '<p style="color:#666;font-size:13px;margin:0">История замеров отсутствует.<br>Данные появятся после следующего сохранения точки.</p>';
    }
    var rows = history.map(function(r) {
      var lps  = r.flowRate != null ? Number(r.flowRate).toFixed(2) : '—';
      var m3h  = r.flowRate != null ? (Number(r.flowRate)*3.6).toFixed(2) : '—';
      var rSc  = STATUS_COLORS[r.status] || '#888';
      return '<tr>' +
        '<td>' + _printFmtDate(r.monitoringDate) + '</td>' +
        '<td><span class="dot" style="background:' + rSc + '"></span>' + (r.status||'—') + '</td>' +
        '<td style="text-align:right"><b>' + lps + '</b></td>' +
        '<td style="text-align:right">' + m3h + '</td>' +
        '<td>' + (r.intensity||'—') + '</td>' +
        '<td>' + (r.measureMethod||'—') + '</td>' +
        '<td>' + (r.worker||'—') + '</td>' +
      '</tr>';
    }).join('');

    // Итог
    var totalLps = 0, cnt = 0;
    history.forEach(function(r) {
      if (r.flowRate != null) { totalLps += Number(r.flowRate); cnt++; }
    });
    var avgLps = cnt ? (totalLps/cnt).toFixed(2) : '—';

    return '<table>' +
      '<thead><tr>' +
        '<th>Дата</th><th>Статус</th>' +
        '<th style="text-align:right">Дебит л/с</th>' +
        '<th style="text-align:right">м³/ч</th>' +
        '<th>Интенсивность</th><th>Метод замера</th><th>Сотрудник</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr>' +
        '<td colspan="2"><b>Итого / среднее (' + history.length + ' замеров)</b></td>' +
        '<td style="text-align:right"><b>' + avgLps + '</b></td>' +
        '<td style="text-align:right">' + (cnt ? (Number(avgLps)*3.6).toFixed(2) : '—') + '</td>' +
        '<td colspan="3"></td>' +
      '</tr></tfoot>' +
    '</table>';
  }

  // ── Строка данных ────────────────────────────────────────
  function row(label, value) {
    if (!value) return '';
    return '<tr><td class="lbl">' + label + '</td><td>' + value + '</td></tr>';
  }

  // ── HTML страницы ────────────────────────────────────────
  var html = '<!DOCTYPE html><html lang="ru"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Точка №' + (p.pointNumber||'') + ' — Карьер ЮРГ</title>' +
    '<style>' +
      '*{box-sizing:border-box;margin:0;padding:0}' +
      'body{font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;background:#fff;padding:20px 28px}' +
      '.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1a1a1a;padding-bottom:10px;margin-bottom:16px}' +
      '.header-left{display:flex;align-items:center;gap:12px}' +
      '.logo{width:36px;height:36px;background:#c8a012;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px;flex-shrink:0}' +
      '.org{font-size:11px;color:#555;margin-top:2px}' +
      '.point-num{font-size:28px;font-weight:700;color:#1a1a1a}' +
      '.status-badge{display:inline-block;padding:3px 12px;border-radius:99px;font-size:12px;font-weight:600;color:#fff;margin-left:10px;vertical-align:middle;background:' + sc + '}' +
      '.print-date{font-size:11px;color:#888;text-align:right}' +
      '.body{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}' +
      '.photo-wrap{grid-column:1/-1}' +
      '.photo-wrap img{width:100%;max-height:260px;object-fit:cover;border-radius:6px;border:1px solid #ddd}' +
      '.photo-wrap .no-photo{height:80px;background:#f5f5f5;border:1px dashed #ccc;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:12px}' +
      '.section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#555;margin-bottom:8px;border-bottom:1px solid #eee;padding-bottom:4px}' +
      'table.info{width:100%;border-collapse:collapse}' +
      'table.info td{padding:4px 6px;vertical-align:top}' +
      'table.info td.lbl{color:#666;font-size:12px;white-space:nowrap;width:40%}' +
      'table.info tr:nth-child(even) td{background:#fafafa}' +
      '.coords{font-size:11px;color:#888;margin-top:4px}' +
      'h3{font-size:13px;font-weight:700;margin:20px 0 10px;border-top:2px solid #1a1a1a;padding-top:10px}' +
      'table{width:100%;border-collapse:collapse;font-size:12px}' +
      'thead th{background:#f0f0f0;padding:5px 8px;text-align:left;font-size:11px;font-weight:600;border:1px solid #ddd}' +
      'tbody td{padding:4px 8px;border:1px solid #eee}' +
      'tbody tr:nth-child(even) td{background:#fafafa}' +
      'tfoot td{padding:5px 8px;border-top:2px solid #ccc;font-size:12px;background:#f5f5f5}' +
      '.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle}' +
      '.footer{margin-top:20px;padding-top:8px;border-top:1px solid #ddd;font-size:10px;color:#aaa;display:flex;justify-content:space-between}' +
      '@media print{' +
        'body{padding:10px 14px}' +
        '@page{size:A4;margin:15mm}' +
        '.no-print{display:none}' +
      '}' +
    '</style>' +
  '</head><body>' +

  // Кнопка печати — скрывается при печати
  '<div class="no-print" style="margin-bottom:14px">' +
    '<button onclick="window.print()" style="padding:8px 20px;background:#1a73e8;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;margin-right:8px">🖨️ Печать</button>' +
    '<button onclick="window.close()" style="padding:8px 16px;background:#f1f1f1;border:1px solid #ccc;border-radius:6px;font-size:13px;cursor:pointer">✕ Закрыть</button>' +
  '</div>' +

  // Шапка
  '<div class="header">' +
    '<div class="header-left">' +
      '<div class="logo">RG</div>' +
      '<div>' +
        '<div style="font-size:15px;font-weight:700">КАРЬЕР ЮРГ</div>' +
        '<div class="org">Мониторинг подземных вод</div>' +
      '</div>' +
    '</div>' +
    '<div class="print-date">Распечатано: ' + new Date().toLocaleString('ru-RU') + '</div>' +
  '</div>' +

  // Заголовок точки
  '<div style="margin-bottom:16px">' +
    '<span class="point-num">Точка №' + (p.pointNumber||'—') + '</span>' +
    '<span class="status-badge">' + (p.status||'Новая') + '</span>' +
  '</div>' +

  // Фото
  '<div class="photo-wrap" style="margin-bottom:16px">' +
    (photoUrl
      ? '<img src="' + photoUrl + '" alt="Фото точки" onerror="this.style.display=\'none\'">'
      : '<div class="no-photo">Фото не загружено</div>') +
  '</div>' +

  // Два блока данных
  '<div class="body">' +

    '<div>' +
      '<div class="section-title">Основные данные</div>' +
      '<table class="info"><tbody>' +
        row('Дата мониторинга', monDate) +
        row('Сотрудник',        p.worker) +
        row('Горизонт / уступ', p.horizon) +
        row('Борт',             p.wall) +
        row('Домен',            p.domain) +
        row('Статус',           p.status) +
      '</tbody></table>' +
    '</div>' +

    '<div>' +
      '<div class="section-title">Замер водопритока</div>' +
      '<table class="info"><tbody>' +
        row('Дебит л/с',    p.flowRate != null ? Number(p.flowRate).toFixed(2)+' л/с' : '') +
        row('Дебит м³/ч',   p.flowRate != null ? (Number(p.flowRate)*3.6).toFixed(2)+' м³/ч' : '') +
        row('Интенсивность', p.intensity) +
        row('Метод замера',  p.measureMethod) +
        row('Цвет воды',     p.waterColor) +
      '</tbody></table>' +
    '</div>' +

  '</div>' +

  // Комментарий
  (p.comment ? '<div style="margin-bottom:16px"><div class="section-title">Комментарий</div><div style="padding:8px;background:#fafafa;border:1px solid #eee;border-radius:4px;font-size:13px">' + p.comment + '</div></div>' : '') +

  // Координаты
  (p.lat || p.xLocal ? '<div class="coords" style="margin-bottom:16px"><div class="section-title">Координаты</div>' +
    (p.lat ? 'GPS: ' + Number(p.lat).toFixed(6) + ', ' + Number(p.lon).toFixed(6) + '&emsp;' : '') +
    (p.xLocal ? 'Локальные: X=' + p.xLocal + ' Y=' + p.yLocal : '') +
  '</div>' : '') +

  // История замеров
  '<h3>История замеров</h3>' +
  buildHistoryTable() +

  // Подвал
  '<div class="footer">' +
    '<span>Точка №' + (p.pointNumber||'') + ' · Создана: ' + _printFmtDateTime(p.createdAt) + ' · Обновлена: ' + _printFmtDateTime(p.updatedAt) + '</span>' +
    '<span>Карьер ЮРГ · Мониторинг подземных вод</span>' +
  '</div>' +

  '<script>window.onload=function(){window.print();}<\/script>' +
  '</body></html>';

  // ── Открываем окно ────────────────────────────────────────
  var win = window.open('', '_blank', 'width=900,height=750');
  if (!win) {
    Toast.show('Браузер заблокировал всплывающее окно. Разрешите и повторите.', 'warning', 5000);
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
