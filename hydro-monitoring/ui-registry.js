// ═══════════════════════════════════════════════════════════════
//  Реестр водопунктов — ui-registry.js
//  Единый справочник всех водопунктов платформы
// ═══════════════════════════════════════════════════════════════

/* ── Типы водопунктов ─────────────────────────────────────────── */
var WP_TYPES = {
  well_obs: { label: 'Наблюдательная скважина', short: 'Набл. скв.',   icon: 'well_obs' },
  well_exp: { label: 'Эксплуатационная скважина', short: 'Эксп. скв.', icon: 'well_exp' },
  sump:     { label: 'Зумпф',                    short: 'Зумпф',       icon: 'sump'     },
  pond:     { label: 'Накопитель / пруд',         short: 'Накопитель',  icon: 'pond'     },
  seep:     { label: 'Водопроявление / родник',   short: 'Водопроявл.', icon: 'seep'     },
  ditch:    { label: 'Дренажная канава',           short: 'Канава',      icon: 'ditch'    },
  other:    { label: 'Прочее',                    short: 'Прочее',      icon: 'other'    },
};

/* SVG-иконки — единый стиль: 20×20, stroke-only, stroke-width 1.6 */
function _regIcon(type, size) {
  var s = size || 20;
  var sw = 1.6;
  var c = 'currentColor';
  var icons = {
    well_obs: '<circle cx="10" cy="10" r="7" fill="none" stroke="' + c + '" stroke-width="' + sw + '"/>' +
              '<circle cx="10" cy="10" r="2.5" fill="' + c + '"/>' +
              '<line x1="10" y1="3" x2="10" y2="1.5" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round"/>',

    well_exp: '<circle cx="10" cy="10" r="7" fill="none" stroke="' + c + '" stroke-width="' + sw + '"/>' +
              '<circle cx="10" cy="10" r="2.5" fill="' + c + '"/>' +
              '<line x1="10" y1="3" x2="10" y2="1.5" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round"/>' +
              '<path d="M7 14 L10 17 L13 14" fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"/>',

    sump:     '<path d="M3 14 L10 6 L17 14 Z" fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-linejoin="round"/>' +
              '<line x1="3" y1="17" x2="17" y2="17" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round"/>',

    pond:     '<path d="M3 13 Q6 9 10 13 Q14 17 17 13" fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round"/>' +
              '<path d="M3 9 Q6 5 10 9 Q14 13 17 9" fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round"/>',

    seep:     '<path d="M10 3 C10 3 5 9 5 13 A5 5 0 0 0 15 13 C15 9 10 3 10 3Z" fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-linejoin="round"/>' +
              '<line x1="8" y1="13" x2="12" y2="13" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round"/>',

    ditch:    '<path d="M2 7 L10 15 L18 7" fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"/>',

    other:    '<rect x="4" y="4" width="12" height="12" rx="2" fill="none" stroke="' + c + '" stroke-width="' + sw + '"/>' +
              '<line x1="10" y1="7" x2="10" y2="13" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round"/>' +
              '<line x1="7" y1="10" x2="13" y2="10" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round"/>',
  };
  return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    (icons[type] || icons.other) + '</svg>';
}

/* ── Состояние ──────────────────────────────────────────────────*/
var RegistryState = {
  items:   [],
  loading: false,
  loaded:  false,
  filterType: '',
  filterQ:    '',
};

/* ── API ────────────────────────────────────────────────────────*/
var RegistryApi = {
  getAll: async function() {
    return Api.client().from('wp_registry').select('*').order('code', { nullsFirst: false }).order('name');
  },
  upsert: async function(row) {
    return Api.client().from('wp_registry').upsert(row, { onConflict: 'id' }).select().single();
  },
  delete: async function(id) {
    return Api.client().from('wp_registry').delete().eq('id', id);
  },
};

/* ── Инициализация ──────────────────────────────────────────────*/
var _regInited = false;
async function initRegistryTab() {
  _regInitCSS();
  if (!_regInited) {
    _regInited = true;
    _regBuildLayout();
  }
  if (!RegistryState.loaded && !RegistryState.loading) {
    RegistryState.loading = true;
    var res = await RegistryApi.getAll();
    if (!res.error) RegistryState.items = res.data || [];
    RegistryState.loaded  = true;
    RegistryState.loading = false;
  }
  _regRender();
}

/* ── CSS ────────────────────────────────────────────────────────*/
function _regInitCSS() {
  if (document.getElementById('reg-css')) return;
  var s = document.createElement('style');
  s.id = 'reg-css';
  s.textContent = [
    /* Page */
    '#page-registry{padding:0!important;overflow:hidden!important}',
    '#page-registry.active{display:flex!important;flex-direction:column!important}',

    /* Shell */
    '.reg-shell{flex:1;display:flex;flex-direction:column;overflow:hidden;padding:20px;gap:14px}',

    /* Header */
    '.reg-hdr{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
    '.reg-title{font-size:17px;font-weight:700;color:var(--txt-1)}',
    '.reg-sub{font-size:12px;color:var(--txt-3);margin-left:4px}',
    '.reg-gap{flex:1}',

    /* Toolbar */
    '.reg-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:10px 14px}',
    '.reg-search{flex:1;min-width:160px;background:var(--bg-1);border:1px solid var(--line);color:var(--txt-1);padding:6px 10px;border-radius:7px;font-size:12px;outline:none;transition:border-color var(--tr);color-scheme:dark}',
    '.reg-search:focus{border-color:rgba(59,130,246,.5)}',
    '.reg-type-chips{display:flex;gap:4px;flex-wrap:wrap}',
    '.reg-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:99px;border:1px solid var(--line);background:none;color:var(--txt-3);font-size:11px;font-weight:500;cursor:pointer;transition:all .15s;white-space:nowrap}',
    '.reg-chip:hover{background:var(--bg-3);color:var(--txt-1)}',
    '.reg-chip.active{background:rgba(59,130,246,.12);border-color:rgba(59,130,246,.4);color:var(--blue)}',
    '.reg-chip-count{opacity:.6;font-size:10px}',

    /* KPI row */
    '.reg-kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}',
    '.reg-kpi{background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:11px 14px;display:flex;align-items:center;gap:10px}',
    '.reg-kpi-ico{width:32px;height:32px;border-radius:8px;background:rgba(59,130,246,.1);color:var(--blue);display:flex;align-items:center;justify-content:center;flex-shrink:0}',
    '.reg-kpi-lbl{font-size:10px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.06em}',
    '.reg-kpi-val{font-size:20px;font-weight:700;color:var(--txt-1);line-height:1.1}',

    /* Table */
    '.reg-table-wrap{flex:1;overflow-y:auto;background:var(--bg-2);border:1px solid var(--line);border-radius:10px}',
    '.reg-tbl{width:100%;border-collapse:collapse;font-size:12px}',
    '.reg-tbl th{position:sticky;top:0;background:var(--bg-2);text-align:left;padding:8px 12px;color:var(--txt-3);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line);z-index:1}',
    '.reg-tbl td{padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:middle}',
    '.reg-tbl tr:last-child td{border-bottom:none}',
    '.reg-tbl tr:hover td{background:rgba(255,255,255,.02)}',

    /* Row elements */
    '.reg-type-cell{display:flex;align-items:center;gap:7px;color:var(--txt-2)}',
    '.reg-type-ico{color:var(--blue);opacity:.8;flex-shrink:0}',
    '.reg-code{font-family:monospace;font-size:12px;font-weight:700;color:var(--blue);background:rgba(59,130,246,.08);padding:2px 6px;border-radius:4px}',
    '.reg-name{font-weight:600;color:var(--txt-1)}',
    '.reg-coords{font-size:10px;color:var(--txt-3);line-height:1.5;font-variant-numeric:tabular-nums}',
    '.reg-status{display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0}',
    '.reg-status-on{background:var(--ok)}',
    '.reg-status-off{background:var(--txt-3)}',

    /* Row actions */
    '.reg-actions{display:flex;gap:4px;justify-content:flex-end;opacity:0;transition:opacity .15s}',
    '.reg-tbl tr:hover .reg-actions{opacity:1}',
    '.reg-act-btn{background:none;border:1px solid var(--line);color:var(--txt-3);padding:3px 8px;border-radius:5px;font-size:11px;cursor:pointer;transition:all .15s;white-space:nowrap}',
    '.reg-act-btn:hover{background:var(--bg-3);color:var(--txt-1)}',
    '.reg-act-del:hover{background:rgba(248,113,113,.1);border-color:rgba(248,113,113,.3);color:#f87171}',

    /* Empty */
    '.reg-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;gap:10px;color:var(--txt-3)}',
    '.reg-empty-ico{width:48px;height:48px;opacity:.3}',
    '.reg-empty-txt{font-size:14px;font-weight:500}',
    '.reg-empty-sub{font-size:12px;text-align:center;max-width:300px;line-height:1.5}',

    /* Buttons */
    '.reg-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:none;font-size:12px;font-weight:600;cursor:pointer;transition:background var(--tr),opacity var(--tr);white-space:nowrap}',
    '.reg-btn-prim{background:var(--blue);color:#fff}',
    '.reg-btn-prim:hover{opacity:.88}',
    '.reg-btn-ghost{background:var(--bg-3);color:var(--txt-2);border:1px solid var(--line)}',
    '.reg-btn-ghost:hover{color:var(--txt-1)}',

    /* Modal */
    '.reg-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px}',
    '.reg-modal{background:var(--bg-2);border:1px solid var(--line);border-radius:14px;width:100%;max-width:700px;max-height:92vh;display:flex;flex-direction:column;overflow:hidden}',
    '.reg-modal-hdr{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--line);flex-shrink:0}',
    '.reg-modal-ico{color:var(--blue)}',
    '.reg-modal-title{font-size:15px;font-weight:700;color:var(--txt-1);flex:1}',
    '.reg-modal-close{background:none;border:none;color:var(--txt-3);font-size:20px;cursor:pointer;padding:4px 8px;border-radius:6px;line-height:1;transition:color var(--tr)}',
    '.reg-modal-close:hover{color:var(--txt-1)}',
    '.reg-modal-body{overflow-y:auto;padding:20px;flex:1;display:flex;flex-direction:column;gap:16px}',
    '.reg-modal-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--line);flex-shrink:0}',

    /* Form */
    '.reg-section{display:flex;flex-direction:column;gap:10px}',
    '.reg-section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);padding-bottom:6px;border-bottom:1px solid var(--line)}',
    '.reg-row{display:grid;gap:10px}',
    '.reg-row-2{grid-template-columns:1fr 1fr}',
    '.reg-row-3{grid-template-columns:1fr 1fr 1fr}',
    '.reg-row-4{grid-template-columns:1fr 1fr 1fr 1fr}',
    '.reg-fld{display:flex;flex-direction:column;gap:4px}',
    '.reg-lbl{font-size:11px;color:var(--txt-3);font-weight:600;text-transform:uppercase;letter-spacing:.04em}',
    '.reg-inp{background:var(--bg-1);border:1px solid var(--line);color:var(--txt-1);padding:7px 10px;border-radius:7px;font-size:13px;transition:border-color var(--tr);outline:none;width:100%;box-sizing:border-box;color-scheme:dark}',
    '.reg-inp:focus{border-color:rgba(59,130,246,.6)}',
    '.reg-inp[type=date]{cursor:pointer}',
    '.reg-hint{font-size:10px;color:var(--txt-3);margin-top:1px}',

    /* Type selector */
    '.reg-type-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}',
    '.reg-type-opt{display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 8px;border-radius:10px;border:1.5px solid var(--line);background:none;cursor:pointer;transition:all .15s;color:var(--txt-3)}',
    '.reg-type-opt:hover{background:var(--bg-3);color:var(--txt-1)}',
    '.reg-type-opt.selected{background:rgba(59,130,246,.1);border-color:rgba(59,130,246,.5);color:var(--blue)}',
    '.reg-type-opt-lbl{font-size:10px;font-weight:600;text-align:center;line-height:1.3}',

    /* Responsive */
    '@media(max-width:640px){.reg-kpi-row{grid-template-columns:1fr 1fr}.reg-row-3,.reg-row-4{grid-template-columns:1fr 1fr}.reg-type-grid{grid-template-columns:repeat(3,1fr)}}',
    '@media(max-width:480px){.reg-row-2,.reg-row-3,.reg-row-4{grid-template-columns:1fr}.reg-type-grid{grid-template-columns:repeat(2,1fr)}}',
  ].join('\n');
  document.head.appendChild(s);
}

/* ── Разметка страницы ──────────────────────────────────────────*/
function _regBuildLayout() {
  var page = document.getElementById('page-registry');
  if (!page) return;
  page.innerHTML = '<div class="reg-shell" id="reg-shell"></div>';
}

/* ── Главный рендер ─────────────────────────────────────────────*/
function _regRender() {
  var shell = document.getElementById('reg-shell');
  if (!shell) return;

  if (RegistryState.loading) {
    shell.innerHTML = '<div class="reg-empty"><div class="reg-empty-txt" style="color:var(--txt-3)">Загрузка…</div></div>';
    return;
  }

  // Фильтрация
  var items = RegistryState.items.filter(function(w) {
    if (RegistryState.filterType && w.wp_type !== RegistryState.filterType) return false;
    if (RegistryState.filterQ) {
      var q = RegistryState.filterQ.toLowerCase();
      if (!(w.name || '').toLowerCase().includes(q) &&
          !(w.code || '').toLowerCase().includes(q) &&
          !(w.notes || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Статистика по типам
  var typeCounts = {};
  RegistryState.items.forEach(function(w) { typeCounts[w.wp_type] = (typeCounts[w.wp_type] || 0) + 1; });

  shell.innerHTML =
    // Заголовок
    '<div class="reg-hdr">' +
      '<span class="reg-title">Реестр водопунктов</span>' +
      '<span class="reg-sub">Единый справочник платформы</span>' +
      '<div class="reg-gap"></div>' +
      '<button class="reg-btn reg-btn-prim" onclick="showRegForm()">' +
        _regIcon('well_obs', 16) + ' Добавить водопункт' +
      '</button>' +
    '</div>' +

    // KPI
    '<div class="reg-kpi-row">' +
      _regKpi('well_obs', 'Набл. скважины',    typeCounts.well_obs || 0) +
      _regKpi('well_exp', 'Эксп. скважины',    typeCounts.well_exp || 0) +
      _regKpi('sump',     'Зумпфы',            (typeCounts.sump || 0)) +
      _regKpi('pond',     'Накопители и прочие', ((typeCounts.pond||0)+(typeCounts.seep||0)+(typeCounts.ditch||0)+(typeCounts.other||0))) +
    '</div>' +

    // Тулбар с фильтрами
    '<div class="reg-toolbar">' +
      '<input class="reg-search" id="reg-search" placeholder="Поиск по коду или названию…" value="' + escHTML(RegistryState.filterQ) + '" oninput="regSearch(this.value)">' +
      '<div class="reg-type-chips">' +
        '<button class="reg-chip' + (!RegistryState.filterType ? ' active' : '') + '" onclick="regFilterType(\'\')">Все <span class="reg-chip-count">' + RegistryState.items.length + '</span></button>' +
        Object.keys(WP_TYPES).map(function(t) {
          var cnt = typeCounts[t] || 0;
          if (!cnt) return '';
          return '<button class="reg-chip' + (RegistryState.filterType === t ? ' active' : '') + '" onclick="regFilterType(\'' + t + '\')">' +
            '<span style="display:inline-flex;align-items:center">' + _regIcon(t, 14) + '</span> ' +
            WP_TYPES[t].short +
            ' <span class="reg-chip-count">' + cnt + '</span>' +
          '</button>';
        }).join('') +
      '</div>' +
    '</div>' +

    // Таблица
    '<div class="reg-table-wrap">' + _regTable(items) + '</div>';
}

function _regKpi(type, label, val) {
  return '<div class="reg-kpi">' +
    '<div class="reg-kpi-ico">' + _regIcon(type, 18) + '</div>' +
    '<div><div class="reg-kpi-lbl">' + label + '</div><div class="reg-kpi-val">' + val + '</div></div>' +
  '</div>';
}

function _regTable(items) {
  if (!items.length) {
    return '<div class="reg-empty">' +
      '<div class="reg-empty-ico">' + _regIcon('other', 48) + '</div>' +
      '<div class="reg-empty-txt">' + (RegistryState.filterType || RegistryState.filterQ ? 'Ничего не найдено' : 'Водопунктов нет') + '</div>' +
      '<div class="reg-empty-sub">' + (RegistryState.filterType || RegistryState.filterQ ? 'Попробуйте изменить фильтр' : 'Нажмите «Добавить водопункт» чтобы начать заполнять реестр') + '</div>' +
    '</div>';
  }

  return '<table class="reg-tbl">' +
    '<thead><tr>' +
      '<th style="width:28px"></th>' +
      '<th>Код</th>' +
      '<th>Наименование</th>' +
      '<th>Тип</th>' +
      '<th>Координаты</th>' +
      '<th>Параметры</th>' +
      '<th style="width:24px"></th>' +
      '<th></th>' +
    '</tr></thead>' +
    '<tbody>' +
    items.map(function(w) {
      var typeInfo = WP_TYPES[w.wp_type] || WP_TYPES.other;
      var coordLocal = (w.coord_x || w.coord_y)
        ? 'X: ' + (w.coord_x || '—') + '<br>Y: ' + (w.coord_y || '—')
        : '';
      var coordWgs = (w.lat || w.lng)
        ? (w.lat ? w.lat.toFixed(5) : '—') + ', ' + (w.lng ? w.lng.toFixed(5) : '—')
        : '';
      var coordHtml = coordLocal
        ? '<span class="reg-coords">' + coordLocal + (coordWgs ? '<br><span style="color:var(--txt-3);opacity:.7">' + coordWgs + '</span>' : '') + '</span>'
        : '<span style="color:var(--txt-3)">—</span>';

      var params = _regParamSummary(w);

      return '<tr>' +
        '<td><span class="reg-status ' + (w.active !== false ? 'reg-status-on' : 'reg-status-off') + '"></span></td>' +
        '<td>' + (w.code ? '<span class="reg-code">' + escHTML(w.code) + '</span>' : '<span style="color:var(--txt-3)">—</span>') + '</td>' +
        '<td><span class="reg-name">' + escHTML(w.name) + '</span>' + (w.notes ? '<div style="font-size:10px;color:var(--txt-3);margin-top:1px">' + escHTML(w.notes.substring(0,60)) + '</div>' : '') + '</td>' +
        '<td><div class="reg-type-cell"><span class="reg-type-ico">' + _regIcon(w.wp_type, 16) + '</span>' + escHTML(typeInfo.short) + '</div></td>' +
        '<td>' + coordHtml + '</td>' +
        '<td><span style="font-size:11px;color:var(--txt-2);line-height:1.6">' + params + '</span></td>' +
        '<td></td>' +
        '<td><div class="reg-actions">' +
          '<button class="reg-act-btn" onclick="showRegForm(\'' + w.id + '\')">Изменить</button>' +
          '<button class="reg-act-btn reg-act-del" onclick="regDelete(\'' + w.id + '\')">Удалить</button>' +
        '</div></td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';
}

function _regParamSummary(w) {
  var parts = [];
  if (w.depth)     parts.push('H=' + w.depth + ' м');
  if (w.diameter)  parts.push('Ø' + w.diameter + ' мм');
  if (w.filter_from !== null && w.filter_from !== undefined && w.filter_to)
    parts.push('фильтр ' + w.filter_from + '–' + w.filter_to + ' м');
  if (w.aquifer)   parts.push(escHTML(w.aquifer));
  if (w.pump_model) parts.push('Насос: ' + escHTML(w.pump_model));
  if (w.pump_capacity) parts.push(w.pump_capacity + ' м³/ч');
  return parts.join(' · ') || '—';
}

/* ── Фильтры ────────────────────────────────────────────────────*/
function regFilterType(t) {
  RegistryState.filterType = t;
  _regRender();
}
function regSearch(q) {
  RegistryState.filterQ = q;
  _regRender();
}

/* ── Форма добавления / редактирования ─────────────────────────*/
var _regFormType = '';

function showRegForm(id) {
  var item = id ? RegistryState.items.find(function(w){ return w.id === id; }) : null;
  _regFormType = item ? item.wp_type : '';

  if (!item) {
    // Шаг 1: выбор типа
    _regOpenModal('Добавить водопункт', _regTypeSelector(), '');
  } else {
    // Сразу открываем форму
    _regOpenModal(
      '<span style="display:inline-flex;align-items:center;gap:8px">' + _regIcon(item.wp_type, 18) + ' Редактировать водопункт</span>',
      _regFormBody(item),
      '<button class="reg-btn reg-btn-ghost" onclick="_regCloseModal()">Отмена</button>' +
      '<button class="reg-btn reg-btn-prim" onclick="_regSave(\'' + id + '\')">Сохранить</button>'
    );
  }
}

function _regTypeSelector() {
  var typeHtml = '<div style="margin-bottom:16px;font-size:12px;color:var(--txt-3)">Выберите тип водопункта — форма заполнения адаптируется под него</div>' +
    '<div class="reg-type-grid">' +
    Object.keys(WP_TYPES).map(function(t) {
      return '<button class="reg-type-opt" data-rtype="' + t + '" onclick="regSelectType(\'' + t + '\')">' +
        '<span style="color:var(--blue)">' + _regIcon(t, 28) + '</span>' +
        '<span class="reg-type-opt-lbl">' + WP_TYPES[t].label + '</span>' +
      '</button>';
    }).join('') +
    '</div>';
  return typeHtml;
}

function regSelectType(t) {
  _regFormType = t;
  var typeInfo = WP_TYPES[t];
  // Перерисовываем модальное окно с формой
  var modal = document.querySelector('.reg-modal');
  if (!modal) return;
  modal.querySelector('.reg-modal-title').innerHTML =
    '<span style="display:inline-flex;align-items:center;gap:8px">' + _regIcon(t, 18) + ' ' + escHTML(typeInfo.label) + '</span>';
  modal.querySelector('.reg-modal-body').innerHTML = _regFormBody(null);
  modal.querySelector('.reg-modal-footer').innerHTML =
    '<button class="reg-btn reg-btn-ghost" onclick="_regCloseModal()">Отмена</button>' +
    '<button class="reg-btn reg-btn-prim" onclick="_regSave(\'\')">Сохранить</button>';
}

function _regFormBody(item) {
  var v = item || {};
  var t = _regFormType;

  var isWell = t === 'well_obs' || t === 'well_exp';
  var isExp  = t === 'well_exp';

  var html =
    // Основные данные
    '<div class="reg-section">' +
      '<div class="reg-section-title">Основные данные</div>' +
      '<div class="reg-row reg-row-2">' +
        _regFld('Наименование *', 'rf-name', 'text', v.name || '', 'Скважина ПН-1') +
        _regFld('Код / Шифр',     'rf-code', 'text', v.code || '', 'ПН-1') +
      '</div>' +
    '</div>' +

    // Координаты местные
    '<div class="reg-section">' +
      '<div class="reg-section-title">Координаты местные (система карьера)</div>' +
      '<div class="reg-row reg-row-2">' +
        _regFld('X',  'rf-cx', 'text', v.coord_x || '', '12345.678', 'м') +
        _regFld('Y',  'rf-cy', 'text', v.coord_y || '', '67890.123', 'м') +
      '</div>' +
    '</div>' +

    // Координаты WGS-84
    '<div class="reg-section">' +
      '<div class="reg-section-title">Координаты WGS-84</div>' +
      '<div class="reg-row reg-row-2">' +
        _regFld('Широта (lat)',   'rf-lat', 'text', v.lat || '', '47.123456') +
        _regFld('Долгота (lng)',  'rf-lng', 'text', v.lng || '', '75.654321') +
      '</div>' +
    '</div>';

  // Доп. поля для скважин
  if (isWell) {
    html +=
      '<div class="reg-section">' +
        '<div class="reg-section-title">Конструкция скважины</div>' +
        '<div class="reg-row reg-row-4">' +
          _regFld('Глубина скв.', 'rf-depth',  'text', v.depth  || '', '120.0', 'м') +
          _regFld('Диаметр тр.', 'rf-diam',   'text', v.diameter || '', '168', 'мм') +
          _regFld('Фильтр от',   'rf-ff',     'text', v.filter_from || '', '95.0', 'м') +
          _regFld('Фильтр до',   'rf-ft',     'text', v.filter_to   || '', '115.0', 'м') +
        '</div>' +
        '<div class="reg-row reg-row-2">' +
          _regFld('Водоносный горизонт', 'rf-aquifer', 'text', v.aquifer || '', 'Юрский водоносный горизонт') +
          _regFld('Дата бурения',        'rf-drilled', 'date', v.drilled_at || '', '') +
        '</div>' +
      '</div>';
  }

  // Доп. поля только для эксплуатационных скважин
  if (isExp) {
    html +=
      '<div class="reg-section">' +
        '<div class="reg-section-title">Насосное оборудование</div>' +
        '<div class="reg-row reg-row-4">' +
          _regFld('Марка насоса',    'rf-pump-model',    'text', v.pump_model    || '', 'ЭЦВ 8-25-110') +
          _regFld('Глубина уст., м', 'rf-pump-depth',    'text', v.pump_depth    || '', '80.0', 'м') +
          _regFld('Произв., м³/ч',   'rf-pump-capacity', 'text', v.pump_capacity || '', '25.0') +
          _regFld('Напор, м',        'rf-pump-head',     'text', v.pump_head     || '', '110.0', 'м') +
        '</div>' +
      '</div>';
  }

  // Примечание
  html +=
    '<div class="reg-section">' +
      '<div class="reg-row" style="grid-template-columns:1fr">' +
        '<div class="reg-fld">' +
          '<label class="reg-lbl">Примечание</label>' +
          '<input class="reg-inp" id="rf-notes" value="' + escHTML(v.notes || '') + '" placeholder="Дополнительная информация">' +
        '</div>' +
      '</div>' +
    '</div>';

  return html;
}

function _regFld(label, id, type, val, placeholder, hint) {
  return '<div class="reg-fld">' +
    '<label class="reg-lbl">' + label + '</label>' +
    '<input class="reg-inp" id="' + id + '" type="' + type + '" value="' + escHTML(String(val)) + '" placeholder="' + escHTML(placeholder || '') + '">' +
    (hint ? '<span class="reg-hint">' + hint + '</span>' : '') +
  '</div>';
}

/* ── Сохранение ─────────────────────────────────────────────────*/
async function _regSave(existingId) {
  var name = (document.getElementById('rf-name') || {}).value;
  if (!name || !name.trim()) { alert('Введите наименование'); return; }

  var t = _regFormType;
  var isWell = t === 'well_obs' || t === 'well_exp';
  var isExp  = t === 'well_exp';

  function fv(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }
  function fn(id) {
    var v = parseFloat((fv(id) || '').replace(',', '.'));
    return isNaN(v) ? null : v;
  }

  var row = {
    wp_type:  t,
    name:     name.trim(),
    code:     fv('rf-code')  || null,
    coord_x:  fn('rf-cx'),
    coord_y:  fn('rf-cy'),
    lat:      fn('rf-lat'),
    lng:      fn('rf-lng'),
    notes:    fv('rf-notes') || null,
    active:   true,
  };

  if (isWell) {
    row.depth       = fn('rf-depth');
    row.diameter    = fn('rf-diam');
    row.filter_from = fn('rf-ff');
    row.filter_to   = fn('rf-ft');
    row.aquifer     = fv('rf-aquifer') || null;
    row.drilled_at  = fv('rf-drilled') || null;
  }
  if (isExp) {
    row.pump_model    = fv('rf-pump-model')    || null;
    row.pump_depth    = fn('rf-pump-depth');
    row.pump_capacity = fn('rf-pump-capacity');
    row.pump_head     = fn('rf-pump-head');
  }
  if (existingId) row.id = existingId;

  var res = await RegistryApi.upsert(row);
  if (res.error) { alert('Ошибка сохранения: ' + res.error.message); return; }
  var saved = res.data;

  if (existingId) {
    RegistryState.items = RegistryState.items.map(function(w){ return w.id === existingId ? saved : w; });
  } else {
    RegistryState.items.push(saved);
  }

  _regCloseModal();
  _regRender();
  if (typeof Toast !== 'undefined') Toast.ok('Водопункт сохранён');
}

/* ── Удаление ───────────────────────────────────────────────────*/
async function regDelete(id) {
  var item = RegistryState.items.find(function(w){ return w.id === id; });
  if (!confirm('Удалить водопункт «' + (item ? item.name : id) + '»?')) return;
  var res = await RegistryApi.delete(id);
  if (res.error) { alert('Ошибка удаления: ' + res.error.message); return; }
  RegistryState.items = RegistryState.items.filter(function(w){ return w.id !== id; });
  _regRender();
  if (typeof Toast !== 'undefined') Toast.ok('Водопункт удалён');
}

/* ── Модальное окно ─────────────────────────────────────────────*/
function _regOpenModal(title, body, footer) {
  _regCloseModal();
  var ov = document.createElement('div');
  ov.className = 'reg-overlay';
  ov.id = 'reg-overlay';
  ov.innerHTML =
    '<div class="reg-modal">' +
      '<div class="reg-modal-hdr">' +
        '<span class="reg-modal-title">' + title + '</span>' +
        '<button class="reg-modal-close" onclick="_regCloseModal()">✕</button>' +
      '</div>' +
      '<div class="reg-modal-body">' + body + '</div>' +
      '<div class="reg-modal-footer">' + (footer || '') + '</div>' +
    '</div>';
  ov.addEventListener('click', function(e) { if (e.target === ov) _regCloseModal(); });
  document.body.appendChild(ov);
}

function _regCloseModal() {
  var ov = document.getElementById('reg-overlay');
  if (ov) ov.remove();
}

/* ── Экспорт в глобальный scope ─────────────────────────────────*/
window.initRegistryTab = initRegistryTab;
window.showRegForm     = showRegForm;
window.regSelectType   = regSelectType;
window.regFilterType   = regFilterType;
window.regSearch       = regSearch;
window.regDelete       = regDelete;
window._regSave        = _regSave;
window._regCloseModal  = _regCloseModal;
