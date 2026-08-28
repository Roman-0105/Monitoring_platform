# geoadmin-server

Node/Express REST API поверх MS SQL Server (`RAYWEBV04`/`GeoLocation`) — заменяет Supabase для web-next на корпоративной инфраструктуре. Подробности и обоснование архитектуры — в плане миграции (у Claude в истории сессии).

## Локальный запуск (без IIS, для разработки)

```bash
cd server
npm install
cp .env.example .env   # заполнить MSSQL_* и FILES_ROOT
npm run dev
```

Без реального IIS личность берётся из `DEV_LOGIN` в `.env` (например `DEV_LOGIN=DOMAIN\\romanyukin`) — так можно тестировать локально, не разворачивая Windows Auth.

## Что внутри

- `src/query-engine.js` — универсальный CRUD-транслятор в T-SQL (аналог PostgREST), понимает `?col=eq.val`, `?col=gte.val`, `order=col.asc`, `select=a,b`, `range=0-999`.
- `src/routes/table.js` — `GET/POST/PATCH/DELETE /api/:table`, всё, что нужно shim-клиенту `web-next/src/lib/supabase.js`.
- `src/routes/whoami.js` — `GET /api/whoami`, роль пользователя по Windows-логину.
- `src/routes/storage.js` — `POST /api/storage/:bucket`, загрузка файлов на диск (`FILES_ROOT`).
- `src/middleware/identity.js` — извлечение Windows-логина; **точный заголовок от IIS/iisnode не проверен на реальном сервере**, см. комментарий в файле — первое, что нужно проверить при деплое.

## Деплой на IIS

1. Скопировать содержимое `server/` (включая `web.config`) в целевую папку на `RAYWEBV04` (или где физически будет сайт).
2. `npm install --production` в этой папке.
3. В IIS Manager: новый сайт/приложение → Windows Authentication = Enabled, Anonymous = Disabled, ограничение по AD-группе.
4. Virtual Directory на `D:\JAM\Prod\GeoAdmin\static\files` для раздачи файлов на чтение.
5. Первым тестовым запросом к `/api/whoami` проверить, что `req.windowsLogin` действительно приходит — если нет, поправить `EXTRACTORS` в `src/middleware/identity.js` под то, что реально шлёт этот IIS.
