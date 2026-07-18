/*
 * Демонстрационные данные для тестовой модели.
 * Справочники (риски/индикаторы/уровни/участки) и первые ~26 записей журнала
 * взяты из реальной выгрузки предприятия (Power BI -> SQL Server, схема dbo).
 * Остальные строки журнала — сгенерированы для наглядной пагинации.
 */

function riPlaceholderPhoto(label, hue) {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">' +
    '<rect width="100%" height="100%" fill="hsl(' + hue + ',30%,16%)"/>' +
    '<rect x="0" y="0" width="100%" height="100%" fill="none" stroke="hsl(' + hue + ',60%,45%)" stroke-width="6"/>' +
    '<text x="50%" y="48%" font-family="sans-serif" font-size="26" fill="hsl(' + hue + ',60%,70%)" text-anchor="middle">📷 фото с формы</text>' +
    '<text x="50%" y="58%" font-family="sans-serif" font-size="16" fill="hsl(' + hue + ',20%,55%)" text-anchor="middle">' + label.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</text>' +
    '</svg>';
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

function riPlaceholderScheme(width, height, label) {
  var lines = [];
  var step = 100;
  for (var gx = 0; gx <= width; gx += step) lines.push('<line x1="' + gx + '" y1="0" x2="' + gx + '" y2="' + height + '" stroke="rgba(148,163,184,.25)" stroke-width="1"/>');
  for (var gy = 0; gy <= height; gy += step) lines.push('<line x1="0" y1="' + gy + '" x2="' + width + '" y2="' + gy + '" stroke="rgba(148,163,184,.25)" stroke-width="1"/>');
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
    '<rect width="100%" height="100%" fill="#1a2130"/>' +
    lines.join('') +
    '<rect x="6" y="6" width="' + (width - 12) + '" height="' + (height - 12) + '" fill="none" stroke="rgba(34,211,238,.5)" stroke-width="3"/>' +
    '<text x="50%" y="47%" font-family="sans-serif" font-size="30" fill="rgba(226,232,240,.6)" text-anchor="middle">🗺 ' + label.replace(/&/g, '&amp;') + '</text>' +
    '<text x="50%" y="55%" font-family="sans-serif" font-size="16" fill="rgba(148,163,184,.6)" text-anchor="middle">демо-схема участка</text>' +
    '</svg>';
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

function seedDb() {
  var fixedRisks = [
    { id: 1, deleted: 0, recordVersion: 0, fixedRisk: 'Геотехнические и гидрогеологические риски' },
    { id: 2, deleted: 0, recordVersion: 1, fixedRisk: 'Посторонний металлический предмет' },
    { id: 3, deleted: 0, recordVersion: 0, fixedRisk: 'Технологические опасности' },
    { id: 4, deleted: 0, recordVersion: 0, fixedRisk: 'Навеси' },
  ];

  var indicators = [
    { id: 1, deleted: 0, recordVersion: 0, indicator: 'Трещина отрыва (Закол)', fixedRisk: 1 },
    { id: 2, deleted: 0, recordVersion: 0, indicator: 'Осыпания', fixedRisk: 1 },
    { id: 3, deleted: 0, recordVersion: 0, indicator: 'Наличие обр. породы', fixedRisk: 1 },
    { id: 4, deleted: 0, recordVersion: 0, indicator: 'Нетипичный водоприток', fixedRisk: 1 },
    { id: 5, deleted: 0, recordVersion: 0, indicator: 'Обрыв бурового инструмента', fixedRisk: 2 },
    { id: 6, deleted: 0, recordVersion: 0, indicator: 'Поломка зубьев ковшей', fixedRisk: 2 },
    { id: 7, deleted: 0, recordVersion: 0, indicator: 'Металлические муфты и соединения', fixedRisk: 2 },
    { id: 8, deleted: 0, recordVersion: 0, indicator: 'Обсадные трубы, штанги', fixedRisk: 2 },
    { id: 9, deleted: 0, recordVersion: 0, indicator: 'Фрагменты футеровочных материалов', fixedRisk: 2 },
    { id: 10, deleted: 0, recordVersion: 0, indicator: 'Элементы ходовых частей', fixedRisk: 2 },
    { id: 11, deleted: 0, recordVersion: 0, indicator: 'Утеря ручного инструмента', fixedRisk: 2 },
    { id: 12, deleted: 0, recordVersion: 0, indicator: 'Другое', fixedRisk: 2 },
    { id: 13, deleted: 0, recordVersion: 0, indicator: 'Геолого-разведочные трубы', fixedRisk: 3 },
    { id: 14, deleted: 0, recordVersion: 0, indicator: 'Порыв трубостава', fixedRisk: 3 },
    { id: 15, deleted: 0, recordVersion: 0, indicator: 'Скользкая дорога', fixedRisk: 3 },
    { id: 16, deleted: 0, recordVersion: 0, indicator: 'Нет отбортовки', fixedRisk: 3 },
    { id: 17, deleted: 0, recordVersion: 0, indicator: 'Навеси / Козырьки', fixedRisk: 1 },
    { id: 18, deleted: 0, recordVersion: 0, indicator: 'Навеси', fixedRisk: 1 },
  ];

  var levels = [
    { id: 2, deleted: 0, recordVersion: 0, level: '1 ур. (Внимание)' },
    { id: 3, deleted: 0, recordVersion: 0, level: '2 ур. (Опасно)' },
    { id: 4, deleted: 0, recordVersion: 0, level: '3 ур. (СТОП!)' },
  ];

  var plotNames = [
    { id: 1, deleted: 0, recordVersion: 0, plotName: 'Карьер ЮРГ' },
    { id: 2, deleted: 0, recordVersion: 0, plotName: 'Карьер СРГ' },
    { id: 3, deleted: 0, recordVersion: 0, plotName: 'ДСК' },
  ];

  var phoneByName = {
    'Ахметбеков Диас': '+7 700 096 0943',
    'Курганский Е.': '+7 747 684 7706',
    'Курганский Е': '+7 747 684 7706',
    'Курганский Егор': '+7 747 684 7706',
    'Амангельдинов Олжас': '+7 776 196 6409',
    'Мухамбетжан Саян': '+7 700 000 0000',
    'Мухамбетжан Саяе': '+7 700 000 0000',
    'Нуркасенов Кайргельды': '+7 705 000 0000',
  };

  // [fname, plotId, indicatorId, levelId|null, 'DD.MM.YYYY HH:MM', closed]
  var raw = [
    ['Ахметбеков Диас', 1, 5, null, '04.07.2026 07:44', false],
    ['Ахметбеков Диас', 1, 5, null, '04.07.2026 07:41', false],
    ['Курганский Е.', 1, 17, 2, '27.06.2026 09:26', false],
    ['Курганский Е.', 1, 17, 2, '27.06.2026 09:18', true],
    ['Курганский Е.', 1, 17, 2, '27.06.2026 08:30', false],
    ['Курганский Е.', 1, 17, 2, '26.06.2026 09:22', false],
    ['Курганский Е', 1, 17, 2, '26.06.2026 09:06', true],
    ['Амангельдинов Олжас', 1, 13, null, '24.06.2026 08:01', true],
    ['Мухамбетжан Саян', 1, 5, null, '05.06.2026 16:49', false],
    ['Ахметбеков Диас', 1, 5, null, '04.06.2026 15:02', false],
    ['Амангельдинов Олжас', 1, 5, null, '29.05.2026 07:39', false],
    ['Амангельдинов Олжас', 1, 5, null, '25.05.2026 14:03', false],
    ['Амангельдинов Олжас', 1, 5, null, '25.05.2026 14:00', false],
    ['Амангельдинов Олжас', 1, 5, null, '23.05.2026 09:31', false],
    ['Нуркасенов Кайргельды', 2, 3, 3, '17.05.2026 18:32', false],
    ['Мухамбетжан Саяе', 1, 5, null, '10.05.2026 17:05', false],
    ['Ахметбеков Диас', 1, 5, null, '07.05.2026 11:49', false],
    ['Ахметбеков Диас', 1, 5, null, '07.05.2026 11:32', false],
    ['Амангельдинов Олжас', 1, 5, null, '29.04.2026 14:57', false],
    ['Амангельдинов Олжас', 1, 5, null, '29.04.2026 14:49', false],
    ['Курганский Егор', 1, 1, 4, '25.04.2026 11:10', false],
    ['Курганский Егор', 1, 1, 3, '25.04.2026 10:57', false],
    ['Курганский Егор', 1, 1, 3, '25.04.2026 10:54', false],
    ['Курганский Егор', 1, 1, 3, '25.04.2026 10:51', false],
    ['Курганский Егор', 1, 1, 2, '25.04.2026 10:48', false],
    ['Курганский Егор', 1, 1, 2, '25.04.2026 10:44', false],
  ];

  var comments = [
    'Слабое высачивание. Образование наледи. Скопление воды на берме.',
    'Видимый водоприток. Незначительное скопление воды на берме.',
    'Обильный водоприток, площадное расширение трещины по борту.',
    'Незначительное скопление обломков в результате разрушения породы.',
    'Обрыв буровой коронки, ~1.5 м, на стакане.',
    'Осыпание, конуса установлены.',
    'Потеря молотка и коронки, на глубине скважины.',
    'Образование трещин на остаточном блоке.',
    'Северный борт (щебкарьер). Образование промоины за счёт паводков.',
    'Выход воды по северной части борта.',
  ];

  function toIso(dmy) {
    var parts = dmy.split(' ');
    var d = parts[0].split('.');
    return d[2] + '-' + d[1] + '-' + d[0] + 'T' + parts[1] + ':00';
  }

  var calllog = [];
  var nextCallId = 1;
  raw.forEach(function(r, idx) {
    var fname = r[0];
    calllog.push({
      id: nextCallId++, deleted: 0, recordVersion: r[5] ? 1 : 0,
      fname: fname, phone: phoneByName[fname] || '+7 700 000 0000',
      comments: comments[idx % comments.length],
      photo: riPlaceholderPhoto(fname, (idx * 47) % 360),
      ip: '95.82.' + (70 + (idx % 20)) + '.' + (100 + idx),
      closed: r[5] ? 1 : 0,
      xwgs: 52.47 + (idx % 10) * 0.002, ywgs: 69.58 + (idx % 7) * 0.003, zwgs: 200 + (idx % 15) * 8,
      xLocal: 16400 + idx * 37.4, yLocal: 46300 + idx * 52.1,
      ddate: toIso(r[4]),
      plotName: r[1], indicator: r[2], level: r[3],
    });
  });

  // Догенерируем ещё строк для реалистичной пагинации (3 страницы).
  var extraNames = ['Синицын Никита', 'Сейланова Дарья', 'Сыздык Бахтияр', 'Канжигалиев Гадылбек', 'Молдаханов Сунгат'];
  var months = ['01', '02', '03', '11', '12'];
  for (var i = 0; i < 34; i++) {
    var fname2 = extraNames[i % extraNames.length];
    var ind = indicators[(i * 3 + 2) % indicators.length];
    var lvl = (ind.fixedRisk === 1) ? levels[i % levels.length].id : null;
    var day = 1 + (i % 27);
    var dstr = '2026-' + months[i % months.length] + '-' + (day < 10 ? '0' + day : day) + 'T' + (8 + (i % 10)) + ':' + (i % 6) * 10 + ':00';
    calllog.push({
      id: nextCallId++, deleted: 0, recordVersion: 0,
      fname: fname2, phone: '+7 70' + (i % 10) + ' 000 00' + (10 + i),
      comments: comments[(i + 3) % comments.length],
      photo: riPlaceholderPhoto(fname2, (i * 63) % 360),
      ip: '95.82.' + (60 + (i % 20)) + '.' + (50 + i),
      closed: i % 5 === 0 ? 1 : 0,
      xwgs: 52.46 + (i % 12) * 0.0025, ywgs: 69.59 + (i % 9) * 0.0031, zwgs: 210 + (i % 18) * 6,
      xLocal: 16200 + i * 41.7, yLocal: 46150 + i * 33.8,
      ddate: dstr,
      plotName: plotNames[i % plotNames.length].id, indicator: ind.id, level: lvl,
    });
  }

  var actions = [
    { id: 1, deleted: 0, todo: 'Водоотводная траншея. На контроле Водоотлива.', date: '2026-06-27T09:30:00', photo: '', calllogId: 4 },
    { id: 2, deleted: 0, todo: 'Нет доступа к участку. Недосягаемая высота.', date: '2026-06-26T09:20:00', photo: '', calllogId: 7 },
    { id: 3, deleted: 0, todo: 'Произвели зачистку участка южного борта гор. +260.', date: '2026-06-24T13:24:00', photo: riPlaceholderPhoto('Зачистка выполнена', 140), calllogId: 8 },
  ];

  var notifications = [
    { id: 1, deleted: 0, recordVersion: 0, fixedRisk: 1, level: 2 },
    { id: 2, deleted: 0, recordVersion: 0, fixedRisk: 1, level: 3 },
    { id: 3, deleted: 0, recordVersion: 0, fixedRisk: 1, level: 4 },
    { id: 4, deleted: 0, recordVersion: 0, fixedRisk: 2, level: null },
    { id: 5, deleted: 0, recordVersion: 0, fixedRisk: 3, level: null },
  ];
  var notificationRecipients = [
    { id: 1, deleted: 0, notificationId: 3, email: 'beibyt.khalimolda@rggold.kz' },
    { id: 2, deleted: 0, notificationId: 3, email: 'Sungat.Moldakhanov@rggold.kz' },
    { id: 3, deleted: 0, notificationId: 3, email: 'Zhanibek.Akimeyev@rggold.kz' },
    { id: 4, deleted: 0, notificationId: 3, email: 'Bakhtiyar.Kunpeisov@rggold.kz' },
    { id: 5, deleted: 0, notificationId: 3, email: 'Dmitriy.Chepizhenko@rggold.kz' },
    { id: 6, deleted: 0, notificationId: 3, email: 'Yegor.Kurganskiy@rggold.kz' },
    { id: 7, deleted: 0, notificationId: 2, email: 'Zhanibek.Akimeyev@rggold.kz' },
    { id: 8, deleted: 0, notificationId: 1, email: 'Yegor.Kurganskiy@rggold.kz' },
  ];

  var contacts = [
    { id: 1, deleted: 0, recordVersion: 0, fname: 'Ахметжанов Бейбит', position: 'Главный геолог', phone: '+7 701 234 5678', email: 'beibyt.khalimolda@rggold.kz' },
    { id: 2, deleted: 0, recordVersion: 0, fname: 'Молдаханов Сунгат', position: 'Инженер по геотехнике', phone: '+7 707 123 1331', email: 'Sungat.Moldakhanov@rggold.kz' },
    { id: 3, deleted: 0, recordVersion: 0, fname: 'Акимеев Жанибек', position: 'Начальник участка', phone: '+7 701 111 2233', email: 'Zhanibek.Akimeyev@rggold.kz' },
  ];

  // Демо-схема только для Карьер ЮРГ (id 1) — границы подобраны так, чтобы
  // покрыть диапазон сгенерированных xLocal/yLocal выше. СРГ и ДСК — без
  // схемы, чтобы показать состояние "схема ещё не загружена".
  var schemes = [
    {
      id: 1, deleted: 0, recordVersion: 0, plotName: 1,
      image: riPlaceholderScheme(1200, 800, 'Карьер ЮРГ'),
      xMin: 16000, xMax: 18000, yMin: 46000, yMax: 48000,
      uploadedAt: '2026-04-01T09:00:00', uploadedBy: 'Roman Yukin',
    },
  ];

  return {
    calllog: calllog, actions: actions,
    fixedRisks: fixedRisks, indicators: indicators, levels: levels, plotNames: plotNames,
    notifications: notifications, notificationRecipients: notificationRecipients,
    contacts: contacts, schemes: schemes,
  };
}
