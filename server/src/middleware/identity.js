// Извлекает Windows-логин аутентифицированного пользователя, которого IIS
// передаёт Node-процессу после Windows Authentication на уровне сайта.
//
// ⚠ ТОЧНОЕ ИМЯ ЗАГОЛОВКА/МЕХАНИЗМ НЕ ПРОВЕРЕНО НА РЕАЛЬНОМ IIS — это известное
// открытое место плана (см. mssql/../plan). iisnode передаёт CGI-переменные
// (LOGON_USER и т.п.) через process.env на старте запроса — под iisnode они
// обычно доступны как req.headers в нижнем регистре с префиксом, либо через
// process.env.LOGON_USER для synchronous-режима. Ниже — несколько вероятных
// источников по порядку; при первом реальном деплое на IIS нужно залогировать
// req.headers и process.env целиком одним тестовым запросом и поправить
// EXTRACTORS под то, что реально приходит.
const EXTRACTORS = [
  (req) => req.headers['x-iisnode-logon_user'],
  (req) => req.headers['logon-user'],
  (req) => req.headers['x-ms-logon-user'],
  (req) => process.env.LOGON_USER,
  (req) => process.env.REMOTE_USER,
];

function extractWindowsLogin(req) {
  for (const fn of EXTRACTORS) {
    const val = fn(req);
    if (val) return String(val).trim();
  }
  // Локальная разработка без IIS: DEV_LOGIN в .env подставляет "себя".
  if (process.env.DEV_LOGIN) return process.env.DEV_LOGIN;
  return null;
}

// Express-middleware: кладёт req.windowsLogin или отвечает 401, если сайт
// почему-то не гарантировал аутентификацию (не должно происходить, если IIS
// настроен правильно — Windows Auth + AD-группа, анонимный доступ выключен).
function requireIdentity(req, res, next) {
  const login = extractWindowsLogin(req);
  if (!login) {
    res.status(401).json({ error: 'Не удалось определить пользователя (Windows-аутентификация не настроена или запрос пришёл в обход IIS)' });
    return;
  }
  req.windowsLogin = login;
  next();
}

module.exports = { extractWindowsLogin, requireIdentity };
