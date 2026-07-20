/* ui-dashboard.js — Дашборд главной страницы */

function renderDashboard() {
  var root = document.getElementById('dashboard-root');
  if (!root) return;

  var points  = typeof getFilteredPoints === 'function' ? getFilteredPoints({}) : (window._allPoints || []);
  var ditches = typeof DitchState !== 'undefined' ? (DitchState.list || []) : [];

  if (!points.length && !ditches.length) {
    root.innerHTML = '<p class="empty-msg" style="padding:40px;text-align:center">Загрузка данных...</p>';
    return;
  }

  // Сортируем даты — находим последние 2
  var dateSet = {};
  points.forEach(function(p){ var d=(p.monitoringDate||'').slice(0,10); if(d) dateSet[d]=1; });
  var allDates = Object.keys(dateSet).sort();
  var lastDate = allDates[allDates.length-1] || '';
  var prevDate = allDates[allDates.length-2] || '';

  var ptsNow  = lastDate ? points.filter(function(p){ return (p.monitoringDate||'').slice(0,10) === lastDate; }) : points;
  var ptsPrev = prevDate ? points.filter(function(p){ return (p.monitoringDate||'').slice(0,10) === prevDate; }) : [];

  // KPI
  var qNow  = ptsNow.reduce(function(s,p){ return s+(parseFloat(p.flowRate)||0); }, 0);
  var qPrev = ptsPrev.reduce(function(s,p){ return s+(parseFloat(p.flowRate)||0); }, 0);
  var dQ    = qNow - qPrev;
  var dQPct = qPrev > 0 ? dQ/qPrev*100 : 0;

  var activeNow  = ptsNow.filter(function(p){ return p.status==='Активная'||p.status==='Паводковая'||p.status==='Перелив'; }).length;
  var floodNow   = ptsNow.filter(function(p){ return p.status==='Паводковая'||p.status==='Перелив'; });
  var ditchesNow = ditches.filter(function(d){ return (d.monitoringDate||'').slice(0,10) === lastDate; });
  var qDitch     = ditchesNow.reduce(function(s,d){ return s+(d.flowLs||d.flowM3h/3.6||0); }, 0);

  // Алерты
  var alerts = [];
  floodNow.forEach(function(p){
    alerts.push({ type:'flood', text:'Точка #'+p.pointNumber+' — '+p.status+' ('+((parseFloat(p.flowRate)||0).toFixed(2))+' л/с)', color:'var(--red)' });
  });
  ptsNow.forEach(function(pb){
    var pa = ptsPrev.find(function(x){ return x.pointNumber===pb.pointNumber; });
    if (!pa) return;
    var qa = parseFloat(pa.flowRate)||0, qb = parseFloat(pb.flowRate)||0;
    if (qa>0 && (qb-qa)/qa > 0.3) {
      alerts.push({ type:'growth', text:'Точка #'+pb.pointNumber+' рост Q +'+((qb-qa)/qa*100).toFixed(0)+'% ('+qb.toFixed(2)+' л/с)', color:'var(--warn,#f9ab00)' });
    }
  });

  // Топ-5 точек по Q
  var topPts = ptsNow.slice().sort(function(a,b){ return (parseFloat(b.flowRate)||0)-(parseFloat(a.flowRate)||0); }).slice(0,5);

  // Мини-спарклайн Q по датам (последние 8 недель)
  var sparkDates = allDates.slice(-8);
  var sparkVals  = sparkDates.map(function(d){
    return points.filter(function(p){ return (p.monitoringDate||'').slice(0,10)===d; })
                 .reduce(function(s,p){ return s+(parseFloat(p.flowRate)||0); },0);
  });
  var sparkMax = Math.max.apply(null, sparkVals) || 1;

  function fmtDate(d) {
    if (!d) return '—';
    var p=d.split('-'); return p.length===3?p[2]+'.'+p[1]+'.'+p[0]:d;
  }
  function trendIcon(v) {
    return v > 0 ? '<span style="color:var(--red)">▲</span>' : v < 0 ? '<span style="color:var(--ok,#39d98a)">▼</span>' : '→';
  }
  function kpiCard(label, val, unit, sub, subColor) {
    return '<div class="dash-kpi">' +
      '<div class="dash-kpi-label">'+label+'</div>' +
      '<div class="dash-kpi-val">'+val+' <span class="dash-kpi-unit">'+unit+'</span></div>' +
      (sub ? '<div class="dash-kpi-sub" style="color:'+(subColor||'var(--txt-3)')+'">'+sub+'</div>' : '') +
    '</div>';
  }

  // SVG Спарклайн
  var W=200, H=40, PL=4, PR=4;
  var n = sparkVals.length;
  var sparkSvg = '';
  if (n >= 2) {
    var iW=W-PL-PR;
    var pts_svg = sparkVals.map(function(v,i){
      return (PL+i/(n-1)*iW).toFixed(1)+','+(H-4-(v/sparkMax*(H-8))).toFixed(1);
    }).join(' ');
    var area = pts_svg+' '+(PL+iW)+','+(H-4)+' '+PL+','+(H-4);
    sparkSvg = '<svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" style="display:block;margin-top:6px">' +
      '<polygon points="'+area+'" fill="var(--blue,#1a73e8)" opacity=".15"/>' +
      '<polyline points="'+pts_svg+'" fill="none" stroke="var(--blue,#1a73e8)" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<circle cx="'+(PL+(n-1)/(n-1)*iW).toFixed(1)+'" cy="'+(H-4-(sparkVals[n-1]/sparkMax*(H-8))).toFixed(1)+'" r="3" fill="var(--blue,#1a73e8)"/>' +
    '</svg>';
    sparkDates.forEach(function(d,i){
      sparkSvg += ''; // даты не нужны в спарке
    });
  }

  var alertsHtml = alerts.length
    ? alerts.slice(0,5).map(function(a){
        return '<div class="dash-alert-row" style="border-left:3px solid '+a.color+'">' +
          '<span style="color:'+a.color+';font-weight:600">' + (a.type==='flood'?'⚠ Паводок':'↑ Рост') + '</span>' +
          ' ' + a.text + '</div>';
      }).join('')
    : '<div style="font-size:12px;color:var(--txt-3);padding:8px 0">✓ Нет активных алертов</div>';

  var topHtml = topPts.map(function(p){
    var q = parseFloat(p.flowRate)||0;
    var pa = ptsPrev.find(function(x){ return x.pointNumber===p.pointNumber; });
    var dq = pa ? q-(parseFloat(pa.flowRate)||0) : null;
    return '<div class="dash-top-row" onclick="switchTab(\'points\')" style="cursor:pointer">' +
      '<span class="dash-top-num">#'+p.pointNumber+'</span>' +
      '<span class="dash-top-domain">'+((p.domain||p.domen||''))+' '+(p.horizon?'горизонт '+p.horizon:'')+' <span style="font-size:10px;color:var(--txt-3)">'+p.status+'</span></span>' +
      '<span class="dash-top-q">'+q.toFixed(2)+'</span>' +
      (dq!==null ? '<span class="dash-top-trend" style="color:'+(dq>0?'var(--red)':dq<0?'var(--ok,#39d98a)':'var(--txt-3)')+'">'+trendIcon(dq)+'</span>' : '') +
    '</div>';
  }).join('');

  root.innerHTML =
    // ── Приветствие
    '<div class="dash-header">' +
      '<div>' +
        '<div class="dash-title">Карьер ЮРГ — Мониторинг</div>' +
        '<div class="dash-sub">Последний замер: <b>'+fmtDate(lastDate)+'</b>' +
          (prevDate ? ' · предыдущий: '+fmtDate(prevDate) : '') + '</div>' +
      '</div>' +
      '<button class="btn btn-sm btn-outline" onclick="loadDashboardData()" style="white-space:nowrap">↻ Обновить</button>' +
    '</div>' +

    // ── KPI
    '<div class="dash-kpi-grid">' +
      kpiCard('Суммарный Q', qNow.toFixed(1), 'л/с',
        dQPct ? trendIcon(dQ)+' '+(dQPct>=0?'+':'')+dQPct.toFixed(0)+'% к прошлой неделе' : 'первый замер',
        dQ>0?'var(--red)':dQ<0?'var(--ok,#39d98a)':'') +
      kpiCard('Активных точек', activeNow, 'из '+ptsNow.length,
        floodNow.length ? '<span style="color:var(--red)">⚠ '+floodNow.length+' паводковых</span>' : '✓ нет паводков',
        floodNow.length?'var(--red)':'var(--ok,#39d98a)') +
      kpiCard('Канавы', ditchesNow.length||ditches.length, 'шт',
        qDitch > 0 ? 'Q канав: '+qDitch.toFixed(2)+' л/с' : 'замеров '+ditches.length) +
      kpiCard('Всего точек', points.length > ptsNow.length ? points.length : ptsNow.length, '',
        allDates.length+' дат мониторинга') +
    '</div>' +

    // ── Динамика Q
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +

      '<div class="card">' +
        '<div class="card-title" style="display:flex;justify-content:space-between;align-items:center">' +
          '<span>Динамика суммарного Q</span>' +
          '<span style="font-size:11px;color:var(--txt-3)">последние '+sparkDates.length+' замеров</span>' +
        '</div>' +
        sparkSvg +
        '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--txt-3);margin-top:2px">' +
          '<span>'+(sparkDates[0]?fmtDate(sparkDates[0]):'')+'</span>' +
          '<span>'+(sparkDates[sparkDates.length-1]?fmtDate(sparkDates[sparkDates.length-1]):'')+'</span>' +
        '</div>' +
      '</div>' +

      '<div class="card">' +
        '<div class="card-title" style="margin-bottom:8px">Алерты</div>' +
        alertsHtml +
      '</div>' +

    '</div>' +

    // ── Топ точек
    '<div class="card">' +
      '<div class="card-title" style="display:flex;justify-content:space-between">' +
        '<span>Топ-5 точек по водопритоку</span>' +
        '<span style="font-size:11px;color:var(--txt-3)">'+fmtDate(lastDate)+'</span>' +
      '</div>' +
      '<div class="dash-top-header">' +
        '<span class="dash-top-num">№</span>' +
        '<span class="dash-top-domain">Домен / горизонт</span>' +
        '<span class="dash-top-q">Q, л/с</span>' +
        '<span class="dash-top-trend">±</span>' +
      '</div>' +
      topHtml +
      '<button class="btn btn-outline btn-full" style="margin-top:10px;font-size:12px" onclick="switchTab(\'points\')">Все точки →</button>' +
    '</div>';
}

function loadDashboardData() {
  var root = document.getElementById('dashboard-root');
  if (root) root.innerHTML = '<p class="empty-msg" style="padding:32px;text-align:center">Загрузка...</p>';
  Promise.all([
    typeof Points !== 'undefined' ? Points.load() : Promise.resolve([]),
    typeof DitchState !== 'undefined' && typeof Api !== 'undefined' ? Api.getDitches('').then(function(r){ DitchState.list = r&&r.ditches?r.ditches:[]; }) : Promise.resolve()
  ]).then(function(){
    renderDashboard();
  }).catch(function(){
    renderDashboard();
  });
}
