/**
 * ui-history.js — вкладка "История" в аналитике.
 * v3: сравнение двух точек на одном графике.
 */

var _histState = {
  selectedPoint:  null,   // первая точка
  selectedPoint2: null,   // вторая точка (для сравнения)
  history:        [],     // история первой точки
  history2:       [],     // история второй точки
  loading:        false,
  clickedDay:     null,
};

// Цвета двух линий
var COMPARE_COLORS = {
  line1: '#1a73e8',   // синий
  line2: '#e8340a',   // красный-оранжевый
};

// ── Нормализация даты ─────────────────────────────────────
function histNormalizeDate(raw) {
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

function histFormatDate(iso) {
  if (!iso || iso.length < 10) return iso || '—';
  return iso.slice(8,10)+'.'+iso.slice(5,7)+'.'+iso.slice(0,4);
}

// ── Агрегация по дням ─────────────────────────────────────
function aggregateByDay(history) {
  var days = {};
  history.forEach(function(r) {
    var dk = histNormalizeDate(r.monitoringDate);
    if (!dk) return;
    if (!days[dk]) days[dk] = { dateKey: dk, records: [] };
    days[dk].records.push(r);
  });
  return Object.keys(days).sort().map(function(dk) {
    var recs = days[dk].records;
    var totalLps = null;
    recs.forEach(function(r) {
      if (r.flowRate != null) totalLps = (totalLps || 0) + r.flowRate;
    });
    return {
      dateKey:   dk,
      dateLabel: histFormatDate(dk),
      totalLps:  totalLps != null ? Math.round(totalLps*100)/100 : null,
      totalM3h:  totalLps != null ? Math.round(totalLps*3.6*100)/100 : null,
      records:   recs,
    };
  });
}

// ── Псевдонимы ────────────────────────────────────────────
function _getAliases() {
  try { return JSON.parse(localStorage.getItem('gm_point_aliases')||'{}'); }
  catch(e) { return {}; }
}

function getHistoryPointOptions() {
  var nums = {};
  Points.getList().forEach(function(p) {
    if (p.pointNumber) nums[String(p.pointNumber)] = true;
  });
  var options = Object.keys(nums).sort(function(a,b) {
    var na=parseFloat(a), nb=parseFloat(b);
    return (isNaN(na)||isNaN(nb)) ? a.localeCompare(b) : na-nb;
  }).map(function(n) { return { value: n, label: 'Точка №'+n }; });
  var aliases = _getAliases();
  Object.keys(aliases).forEach(function(name) {
    options.push({ value: '__alias__'+name, label: '🔗 '+name });
  });
  return options;
}

function resolvePointNumbers(selected) {
  if (!selected) return [];
  if (selected.indexOf('__alias__') === 0)
    return (_getAliases()[selected.slice(9)] || []);
  return [selected];
}

function getPointLabel(selected) {
  if (!selected) return '';
  if (selected.indexOf('__alias__') === 0) return '🔗 '+selected.slice(9);
  return 'Точка №'+selected;
}

// ── Инициализация вкладки ─────────────────────────────────
function initHistoryTab() {
  var sel1 = document.getElementById('history-point-select');
  var sel2 = document.getElementById('history-point-select2');
  if (!sel1) return;

  var opts = getHistoryPointOptions();

  function fillSelect(sel, current) {
    sel.innerHTML = '<option value="">— выберите точку —</option>';
    opts.forEach(function(o) {
      var opt = document.createElement('option');
      opt.value = o.value; opt.textContent = o.label;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  }

  fillSelect(sel1, _histState.selectedPoint);
  if (sel2) fillSelect(sel2, _histState.selectedPoint2);

  if (!sel1._bound) {
    sel1._bound = true;
    sel1.addEventListener('change', function() {
      _histState.selectedPoint = sel1.value || null;
      _histState.clickedDay    = null;
      loadAndRenderHistory();
    });
  }
  if (sel2 && !sel2._bound) {
    sel2._bound = true;
    sel2.addEventListener('change', function() {
      _histState.selectedPoint2 = sel2.value || null;
      _histState.clickedDay     = null;
      loadAndRenderHistory();
    });
  }

  // Кнопка сброса второй точки
  var clearBtn = document.getElementById('history-compare-clear');
  if (clearBtn && !clearBtn._bound) {
    clearBtn._bound = true;
    clearBtn.addEventListener('click', function() {
      _histState.selectedPoint2 = null;
      _histState.clickedDay     = null;
      if (sel2) { sel2.value = ''; }
      loadAndRenderHistory();
    });
  }

  if (_histState.selectedPoint) loadAndRenderHistory();
  else renderHistoryEmpty();
}

// ── Загрузка данных ───────────────────────────────────────
function loadAndRenderHistory() {
  var chartArea = document.getElementById('history-chart-area');
  var infoPanel = document.getElementById('history-info-panel');
  if (!chartArea) return;

  var nums1 = resolvePointNumbers(_histState.selectedPoint);
  var nums2 = resolvePointNumbers(_histState.selectedPoint2);

  if (!nums1.length && !nums2.length) { renderHistoryEmpty(); return; }

  chartArea.innerHTML = '<p style="padding:16px;font-size:13px;color:var(--txt-3)">⏳ Загрузка...</p>';
  if (infoPanel) infoPanel.innerHTML = '';
  _histState.loading = true;

  var p1 = nums1.length
    ? Promise.all(nums1.map(function(n){ return Api.getHistory(n); }))
        .then(function(res){ var r=[]; res.forEach(function(x){ r=r.concat(x||[]); }); return r; })
    : Promise.resolve([]);

  var p2 = nums2.length
    ? Promise.all(nums2.map(function(n){ return Api.getHistory(n); }))
        .then(function(res){ var r=[]; res.forEach(function(x){ r=r.concat(x||[]); }); return r; })
    : Promise.resolve([]);

  Promise.all([p1, p2]).then(function(results) {
    function norm(arr) {
      arr.forEach(function(r) { r.monitoringDate = histNormalizeDate(r.monitoringDate); });
      arr.sort(function(a,b){ return a.monitoringDate < b.monitoringDate ? -1 : 1; });
      return arr;
    }
    _histState.history  = norm(results[0]);
    _histState.history2 = norm(results[1]);
    _histState.loading  = false;

    var compareMode = _histState.selectedPoint2 && results[1].length > 0;
    if (compareMode) renderCompareChart();
    else             renderHistoryChart();
  }).catch(function(err) {
    _histState.loading = false;
    chartArea.innerHTML = '<p style="padding:16px;color:#ea4335;font-size:13px">Ошибка: '+err.message+'</p>';
  });
}

function renderHistoryEmpty() {
  var a = document.getElementById('history-chart-area');
  if (a) a.innerHTML = '<p style="padding:24px;font-size:13px;color:var(--txt-3);text-align:center">Выберите точку для просмотра истории замеров</p>';
}

// ── РЕЖИМ СРАВНЕНИЯ ДВУХ ТОЧЕК ────────────────────────────
function renderCompareChart() {
  var chartArea = document.getElementById('history-chart-area');
  var infoPanel = document.getElementById('history-info-panel');
  if (!chartArea) return;

  var days1 = aggregateByDay(_histState.history);
  var days2 = aggregateByDay(_histState.history2);

  if (!days1.length && !days2.length) {
    chartArea.innerHTML = '<p style="padding:24px;font-size:13px;color:var(--txt-3);text-align:center">Нет данных истории для выбранных точек</p>';
    return;
  }

  // Объединяем все уникальные даты
  var allDates = {};
  days1.forEach(function(d){ allDates[d.dateKey] = true; });
  days2.forEach(function(d){ allDates[d.dateKey] = true; });
  var allKeys = Object.keys(allDates).sort();

  var map1 = {}; days1.forEach(function(d){ map1[d.dateKey] = d; });
  var map2 = {}; days2.forEach(function(d){ map2[d.dateKey] = d; });

  var PAD = { top:28, right:60, bottom:72, left:52 };
  var minW = 480;
  var dynW = Math.max(minW, allKeys.length * 80 + PAD.left + PAD.right);
  var W = dynW, H = 280;
  var chartW = W - PAD.left - PAD.right;
  var chartH = H - PAD.top - PAD.bottom;

  // Максимум по обоим рядам
  var allVals = [];
  days1.forEach(function(d){ if(d.totalLps!=null) allVals.push(d.totalLps); });
  days2.forEach(function(d){ if(d.totalLps!=null) allVals.push(d.totalLps); });
  var maxLps = allVals.length ? Math.max.apply(null, allVals) : 1;
  if (maxLps === 0) maxLps = 1;

  var n = allKeys.length;
  function xPos(i){ return n===1 ? PAD.left+chartW/2 : PAD.left+(i/(n-1))*chartW; }
  function yPos(v){ return v==null ? null : PAD.top+chartH-(v/maxLps)*chartH; }

  function buildLine(map, color) {
    var path='', area='', firstPt=true, fi=-1, li=-1;
    allKeys.forEach(function(dk,i){
      var d = map[dk];
      var v = d ? d.totalLps : null;
      if (v!=null){ if(fi<0)fi=i; li=i; }
      var y=yPos(v);
      if(y==null){firstPt=true;return;}
      path+=(firstPt?'M':'L')+xPos(i).toFixed(1)+','+y.toFixed(1)+' ';
      firstPt=false;
    });
    if(fi>=0){
      var base=(PAD.top+chartH).toFixed(1);
      area='M'+xPos(fi).toFixed(1)+','+base+' '+path.replace(/^M/,'L')+
           'L'+xPos(li).toFixed(1)+','+base+' Z';
    }
    return { path:path, area:area };
  }

  var L1 = buildLine(map1, COMPARE_COLORS.line1);
  var L2 = buildLine(map2, COMPARE_COLORS.line2);

  // Оси Y
  var yTicks = [0, maxLps/2, maxLps];

  var svg = '<svg width="'+W+'" height="'+H+'" xmlns="http://www.w3.org/2000/svg" style="display:block;min-width:'+W+'px">';

  // Сетка
  yTicks.forEach(function(v){
    var y=yPos(v).toFixed(1);
    svg+='<line x1="'+PAD.left+'" y1="'+y+'" x2="'+(PAD.left+chartW)+'" y2="'+y+'" stroke="rgba(255,255,255,.07)" stroke-width="1"/>';
    svg+='<text x="'+(PAD.left-6)+'" y="'+(Number(y)+4)+'" text-anchor="end" font-size="11" fill="rgba(180,190,210,.6)">'+v.toFixed(2)+'</text>';
    svg+='<text x="'+(PAD.left+chartW+6)+'" y="'+(Number(y)+4)+'" text-anchor="start" font-size="10" fill="rgba(251,188,5,.5)">'+(v*3.6).toFixed(2)+'</text>';
  });
  svg+='<text x="'+(PAD.left-6)+'" y="'+(PAD.top-10)+'" text-anchor="end" font-size="10" fill="rgba(180,190,210,.45)">л/с</text>';
  svg+='<text x="'+(PAD.left+chartW+6)+'" y="'+(PAD.top-10)+'" text-anchor="start" font-size="10" fill="rgba(251,188,5,.4)">м³/ч</text>';

  // Области (полупрозрачные)
  if(L1.area) svg+='<path d="'+L1.area+'" fill="'+COMPARE_COLORS.line1+'" opacity="0.08"/>';
  if(L2.area) svg+='<path d="'+L2.area+'" fill="'+COMPARE_COLORS.line2+'" opacity="0.08"/>';

  // Линии
  if(L1.path) svg+='<path d="'+L1.path+'" fill="none" stroke="'+COMPARE_COLORS.line1+'" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>';
  if(L2.path) svg+='<path d="'+L2.path+'" fill="none" stroke="'+COMPARE_COLORS.line2+'" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="6 3"/>';

  // Маркеры и даты
  allKeys.forEach(function(dk, i) {
    var x   = xPos(i);
    var d1  = map1[dk];
    var d2  = map2[dk];
    var y1  = d1 ? yPos(d1.totalLps) : null;
    var y2  = d2 ? yPos(d2.totalLps) : null;

    // Дата под 45°
    var dateY = H-6;
    svg+='<text x="'+x.toFixed(1)+'" y="'+dateY+'" text-anchor="end" font-size="10" fill="rgba(180,190,210,.65)" transform="rotate(-45,'+x.toFixed(1)+','+dateY+')">'+histFormatDate(dk)+'</text>';

    // Маркер точки 1
    if(y1!=null){
      svg+='<circle class="hist-cmp-dot" cx="'+x.toFixed(1)+'" cy="'+y1.toFixed(1)+'" r="8" fill="'+COMPARE_COLORS.line1+'" stroke="#1e2530" stroke-width="2" style="cursor:pointer" data-dk="'+dk+'" data-series="1"/>';
      svg+='<text x="'+x.toFixed(1)+'" y="'+(y1-13)+'" text-anchor="middle" font-size="10" font-weight="600" fill="'+COMPARE_COLORS.line1+'">'+d1.totalLps.toFixed(2)+'</text>';
    }
    // Маркер точки 2
    if(y2!=null){
      var offset = (y1!=null && Math.abs(y1-y2)<14) ? 14 : 0; // сдвиг если маркеры перекрываются
      svg+='<circle class="hist-cmp-dot" cx="'+(x+offset).toFixed(1)+'" cy="'+y2.toFixed(1)+'" r="7" fill="'+COMPARE_COLORS.line2+'" stroke="#1e2530" stroke-width="2" style="cursor:pointer" data-dk="'+dk+'" data-series="2"/>';
      svg+='<text x="'+(x+offset).toFixed(1)+'" y="'+(y2-12)+'" text-anchor="middle" font-size="10" font-weight="600" fill="'+COMPARE_COLORS.line2+'">'+d2.totalLps.toFixed(2)+'</text>';
    }
  });

  svg+='</svg>';

  // Легенда
  var label1 = getPointLabel(_histState.selectedPoint);
  var label2 = getPointLabel(_histState.selectedPoint2);
  var legend =
    '<div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:10px;align-items:center">'+
    '<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--txt-1)">'+
      '<span style="display:inline-block;width:24px;height:3px;background:'+COMPARE_COLORS.line1+';border-radius:2px"></span>'+
      label1+'</span>'+
    '<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--txt-1)">'+
      '<span style="display:inline-block;width:24px;height:3px;background:'+COMPARE_COLORS.line2+';border-radius:2px;border-bottom:2px dashed '+COMPARE_COLORS.line2+';height:0"></span>'+
      label2+' <span style="font-size:10px;color:var(--txt-3)">(штрих)</span></span>'+
    '<span style="font-size:11px;color:var(--txt-3);margin-left:4px">нажми на маркер для деталей</span>'+
    '</div>';

  chartArea.innerHTML = legend+'<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">'+svg+'</div>';

  // Клики по маркерам
  chartArea.querySelectorAll('.hist-cmp-dot').forEach(function(dot) {
    dot.addEventListener('click', function() {
      var dk     = this.getAttribute('data-dk');
      var series = this.getAttribute('data-series');
      var day    = series === '1' ? map1[dk] : map2[dk];
      var label  = series === '1' ? label1 : label2;
      var color  = series === '1' ? COMPARE_COLORS.line1 : COMPARE_COLORS.line2;
      if (day) renderHistoryDayDetail(day, label, color);
    });
  });

  // Таблица сравнения под графиком
  renderCompareTable(allKeys, map1, map2, label1, label2);
}

// Сравнительная таблица дат
function renderCompareTable(allKeys, map1, map2, label1, label2) {
  var infoPanel = document.getElementById('history-info-panel');
  if (!infoPanel) return;

  var html =
    '<div style="background:var(--card-bg,#1e2530);border:1px solid var(--line);border-radius:12px;padding:14px 16px">' +
    '<div style="font-size:13px;font-weight:600;color:var(--txt-1);margin-bottom:10px">Таблица сравнения</div>' +
    '<div style="overflow-x:auto">' +
    '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
    '<thead><tr style="border-bottom:1px solid var(--line);color:var(--txt-3);font-size:11px">' +
      '<th style="padding:5px 6px;text-align:left">Дата</th>' +
      '<th style="padding:5px 6px;text-align:right;color:'+COMPARE_COLORS.line1+'">'+label1+'<br>л/с</th>' +
      '<th style="padding:5px 6px;text-align:right;color:'+COMPARE_COLORS.line2+'">'+label2+'<br>л/с</th>' +
      '<th style="padding:5px 6px;text-align:right">Разница<br>л/с</th>' +
    '</tr></thead><tbody>';

  allKeys.forEach(function(dk) {
    var d1 = map1[dk], d2 = map2[dk];
    var v1 = d1 && d1.totalLps != null ? d1.totalLps : null;
    var v2 = d2 && d2.totalLps != null ? d2.totalLps : null;
    var diff = (v1!=null && v2!=null) ? Math.round((v1-v2)*100)/100 : null;
    var diffStr = diff!=null
      ? '<span style="color:'+(diff>0?COMPARE_COLORS.line1:diff<0?COMPARE_COLORS.line2:'var(--txt-3)')+'">'+
          (diff>0?'+':'')+diff.toFixed(2)+'</span>'
      : '—';
    html +=
      '<tr style="border-bottom:1px solid rgba(255,255,255,.04)">' +
        '<td style="padding:5px 6px;color:var(--txt-2)">'+histFormatDate(dk)+'</td>' +
        '<td style="padding:5px 6px;text-align:right;color:'+COMPARE_COLORS.line1+';font-weight:'+(v1!=null?'600':'400')+'">'+(v1!=null?v1.toFixed(2):'—')+'</td>' +
        '<td style="padding:5px 6px;text-align:right;color:'+COMPARE_COLORS.line2+';font-weight:'+(v2!=null?'600':'400')+'">'+(v2!=null?v2.toFixed(2):'—')+'</td>' +
        '<td style="padding:5px 6px;text-align:right">'+diffStr+'</td>' +
      '</tr>';
  });

  html += '</tbody></table></div></div>';
  infoPanel.innerHTML = html;
}

// ── ОДИНОЧНЫЙ РЕЖИМ (существующий) ───────────────────────
function renderHistoryChart() {
  var chartArea = document.getElementById('history-chart-area');
  if (!chartArea) return;

  var days = aggregateByDay(_histState.history);
  if (!days.length) {
    chartArea.innerHTML = '<p style="padding:24px;font-size:13px;color:var(--txt-3);text-align:center">Нет данных истории.<br>Данные появятся после следующего сохранения точки.</p>';
    return;
  }

  var STATUS_COLORS = (typeof MapModule !== 'undefined') ? MapModule.STATUS_COLORS : {
    'Новая':'#1a73e8','Активная':'#34a853','Иссякает':'#f9ab00','Пересохла':'#ea4335'
  };

  var PAD = { top:28, right:56, bottom:68, left:52 };
  var dynW = Math.max(480, days.length * 80 + PAD.left + PAD.right);
  var W = dynW, H = 280;
  var chartW = W - PAD.left - PAD.right;
  var chartH = H - PAD.top - PAD.bottom;

  var defined = days.filter(function(d){ return d.totalLps!=null; });
  var maxLps  = defined.length ? Math.max.apply(null, defined.map(function(d){ return d.totalLps; })) : 1;
  if (maxLps===0) maxLps=1;

  var n = days.length;
  function xPos(i){ return n===1 ? PAD.left+chartW/2 : PAD.left+(i/(n-1))*chartW; }
  function yPos(v){ return v==null ? null : PAD.top+chartH-(v/maxLps)*chartH; }

  var linePath='', areaPath='', firstPt=true, fi=-1, li=-1;
  days.forEach(function(d,i){
    if(d.totalLps!=null){if(fi<0)fi=i;li=i;}
    var y=yPos(d.totalLps);
    if(y==null){firstPt=true;return;}
    linePath+=(firstPt?'M':'L')+xPos(i).toFixed(1)+','+y.toFixed(1)+' ';
    firstPt=false;
  });
  if(fi>=0){
    var base=(PAD.top+chartH).toFixed(1);
    areaPath='M'+xPos(fi).toFixed(1)+','+base+' '+linePath.replace(/^M/,'L')+
             'L'+xPos(li).toFixed(1)+','+base+' Z';
  }

  var yTicks=[0,maxLps/2,maxLps];
  var svg='<svg width="'+W+'" height="'+H+'" xmlns="http://www.w3.org/2000/svg" style="display:block;min-width:'+W+'px">';

  yTicks.forEach(function(v){
    var y=yPos(v).toFixed(1);
    svg+='<line x1="'+PAD.left+'" y1="'+y+'" x2="'+(PAD.left+chartW)+'" y2="'+y+'" stroke="rgba(255,255,255,.07)" stroke-width="1"/>';
    svg+='<text x="'+(PAD.left-6)+'" y="'+(Number(y)+4)+'" text-anchor="end" font-size="11" fill="rgba(180,190,210,.6)">'+v.toFixed(2)+'</text>';
    svg+='<text x="'+(PAD.left+chartW+6)+'" y="'+(Number(y)+4)+'" text-anchor="start" font-size="10" fill="rgba(251,188,5,.55)">'+(v*3.6).toFixed(2)+'</text>';
  });
  svg+='<text x="'+(PAD.left-6)+'" y="'+(PAD.top-10)+'" text-anchor="end" font-size="10" fill="rgba(180,190,210,.45)">л/с</text>';
  svg+='<text x="'+(PAD.left+chartW+6)+'" y="'+(PAD.top-10)+'" text-anchor="start" font-size="10" fill="rgba(251,188,5,.4)">м³/ч</text>';

  if(areaPath) svg+='<path d="'+areaPath+'" fill="rgba(26,115,232,.1)"/>';
  if(linePath) svg+='<path d="'+linePath+'" fill="none" stroke="#1a73e8" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>';

  var INTENSITY_R={'Слабая (капёж)':6,'Умеренная':9,'Сильная (поток)':12,'Очень сильная':16};

  days.forEach(function(d,i){
    var x=xPos(i), y=yPos(d.totalLps);
    var isSelected=_histState.clickedDay && _histState.clickedDay.dateKey===d.dateKey;
    var statusCount={};
    d.records.forEach(function(r){ statusCount[r.status||'']=(statusCount[r.status||'']||0)+1; });
    var dom=Object.keys(statusCount).sort(function(a,b){return statusCount[b]-statusCount[a];})[0]||'';
    var sc=STATUS_COLORS[dom]||'#1a73e8';
    var cnt=d.records.length;

    var dateY=H-6;
    svg+='<text x="'+x.toFixed(1)+'" y="'+dateY+'" text-anchor="end" font-size="10" fill="rgba(180,190,210,.7)" transform="rotate(-45,'+x.toFixed(1)+','+dateY+')">'+d.dateLabel+'</text>';

    if(y!=null){
      if(isSelected) svg+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="18" fill="'+sc+'" opacity="0.18"/>';
      svg+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+(cnt>1?12:9)+'" fill="'+sc+'" stroke="#1e2530" stroke-width="2" style="cursor:pointer" class="hist-day-dot" data-idx="'+i+'"/>';
      svg+='<text x="'+x.toFixed(1)+'" y="'+(Number(y)-16)+'" text-anchor="middle" font-size="10" font-weight="600" fill="rgba(210,220,240,.9)">'+d.totalLps.toFixed(2)+'</text>';
      if(cnt>1) svg+='<text x="'+x.toFixed(1)+'" y="'+(Number(y)+4)+'" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">'+cnt+'</text>';
    }
  });

  svg+='</svg>';

  var seen={};
  days.forEach(function(d){ d.records.forEach(function(r){ if(r.status) seen[r.status]=STATUS_COLORS[r.status]||'#888'; }); });
  var legend='<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px;align-items:center">';
  Object.keys(seen).forEach(function(s){
    legend+='<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--txt-2)">'+
             '<span style="width:10px;height:10px;border-radius:50%;background:'+seen[s]+';flex-shrink:0"></span>'+s+'</span>';
  });
  legend+='<span style="font-size:11px;color:var(--txt-3);margin-left:6px">цифра = кол-во замеров · нажми на маркер</span></div>';

  chartArea.innerHTML=legend+'<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">'+svg+'</div>';

  chartArea.querySelectorAll('.hist-day-dot').forEach(function(dot){
    dot.addEventListener('click', function(){
      var idx=parseInt(this.getAttribute('data-idx'));
      _histState.clickedDay=days[idx];
      renderHistoryDayDetail(days[idx]);
      renderHistoryChart();
    });
  });

  if(_histState.clickedDay){
    var still=days.find(function(d){ return d.dateKey===_histState.clickedDay.dateKey; });
    if(still) renderHistoryDayDetail(still);
  }
}

// ── Детализация дня (клик по маркеру) ────────────────────
function renderHistoryDayDetail(day, seriesLabel, seriesColor) {
  var panel=document.getElementById('history-info-panel');
  if(!panel) return;

  var STATUS_COLORS=(typeof MapModule!=='undefined') ? MapModule.STATUS_COLORS : {};
  var accentColor = seriesColor || '#1a73e8';

  var html=
    '<div style="background:var(--card-bg,#1e2530);border:1px solid var(--line);border-radius:12px;padding:14px 16px">'+
    '<div style="font-size:14px;font-weight:600;color:var(--txt-1);margin-bottom:4px">'+
      (seriesLabel ? '<span style="color:'+accentColor+'">'+seriesLabel+'</span> · ' : '')+
      '📅 '+day.dateLabel+
    '</div>'+
    '<div style="display:flex;gap:12px;margin-bottom:12px">'+
      '<div style="text-align:center;flex:1;background:rgba(26,115,232,.1);border-radius:8px;padding:7px 4px">'+
        '<div style="font-size:18px;font-weight:700;color:'+accentColor+'">'+
          (day.totalLps!=null?day.totalLps.toFixed(2):'—')+'</div>'+
        '<div style="font-size:10px;color:var(--txt-3)">л/с</div>'+
      '</div>'+
      '<div style="text-align:center;flex:1;background:rgba(251,188,5,.1);border-radius:8px;padding:7px 4px">'+
        '<div style="font-size:18px;font-weight:700;color:#f9ab00">'+
          (day.totalM3h!=null?day.totalM3h.toFixed(2):'—')+'</div>'+
        '<div style="font-size:10px;color:var(--txt-3)">м³/ч</div>'+
      '</div>'+
      '<div style="text-align:center;flex:1;background:rgba(255,255,255,.05);border-radius:8px;padding:7px 4px">'+
        '<div style="font-size:18px;font-weight:700;color:var(--txt-1)">'+day.records.length+'</div>'+
        '<div style="font-size:10px;color:var(--txt-3)">замеров</div>'+
      '</div>'+
    '</div>'+
    '<div style="font-size:11px;color:var(--txt-3);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em">Детализация</div>'+
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">'+
    '<thead><tr style="color:var(--txt-3);border-bottom:1px solid var(--line)">'+
      '<th style="padding:4px 6px;text-align:left;font-weight:500">Точка</th>'+
      '<th style="padding:4px 6px;text-align:right;font-weight:500">л/с</th>'+
      '<th style="padding:4px 6px;text-align:right;font-weight:500">м³/ч</th>'+
      '<th style="padding:4px 6px;text-align:left;font-weight:500">Статус</th>'+
      '<th style="padding:4px 6px;text-align:left;font-weight:500">Метод</th>'+
      '<th style="padding:4px 6px;text-align:left;font-weight:500">Сотрудник</th>'+
    '</tr></thead><tbody>';

  day.records.forEach(function(r){
    var sc=STATUS_COLORS[r.status]||'#888';
    var lps=r.flowRate!=null?r.flowRate.toFixed(2):'—';
    var m3h=r.flowRate!=null?(r.flowRate*3.6).toFixed(2):'—';
    html+=
      '<tr style="border-bottom:1px solid rgba(255,255,255,.04)">'+
        '<td style="padding:5px 6px;font-weight:600;color:var(--txt-1)">№'+escAttr(String(r.pointNumber))+'</td>'+
        '<td style="padding:5px 6px;text-align:right;color:#1a73e8">'+lps+'</td>'+
        '<td style="padding:5px 6px;text-align:right;color:#f9ab00">'+m3h+'</td>'+
        '<td style="padding:5px 6px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+sc+';margin-right:4px"></span>'+escAttr(r.status||'—')+'</td>'+
        '<td style="padding:5px 6px;color:var(--txt-2)">'+escAttr(r.measureMethod||'—')+'</td>'+
        '<td style="padding:5px 6px;color:var(--txt-2)">'+escAttr(r.worker||'—')+'</td>'+
      '</tr>';
  });

  html+='</tbody></table></div></div>';
  panel.innerHTML=html;
}
