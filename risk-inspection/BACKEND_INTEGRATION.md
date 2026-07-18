# Подключение админ-панели «Инспекция участков» к боевой БД

Этот документ — то, что нужно передать IT-отделу предприятия, чтобы
перевести панель из тестового режима (локальные мок-данные в браузере)
в рабочий режим (реальные данные из SQL Server).

## 1. Что уже есть, что нужно построить

**Уже работает и не трогается:**
- Мобильная форма + генерация QR-кода (сканирование на объекте, фото, GPS).
- Таблица `GEOLOCATION_CALLLOG` в SQL Server, в которую эта форма пишет.
- Раздача фото по адресу `https://geoadmin.rggold.kz/static/files/<PHOTO>`.

**Нужно построить (эта задача):**
- Небольшой REST API поверх существующего SQL Server — браузер не умеет
  подключаться к SQL Server напрямую (нет драйвера, да и небезопасно
  открывать порт 1433 в интернет). API — единственная прослойка, которой
  не хватает.

```
[ Телефон рабочего ]──QR/форма──▶[ GEOLOCATION_CALLLOG (уже пишет) ]
                                            │
[ Браузер: risk-inspection/*.html ]──REST──▶[ Новый API ]──▶[ тот же SQL Server ]
```

Рекомендация: разместить новый API на том же сервере/домене
`geoadmin.rggold.kz` (например, `geoadmin.rggold.kz/api/...`), рядом с уже
работающей раздачей файлов — тогда не будет проблем с CORS и панель можно
открывать прямо с этого домена.

## 2. Структура данных (SQL Server, схема `dbo`)

Ниже — таблицы, которые уже существуют на сервере (структура подтверждена
выгрузкой через Power BI), и две новые, которые нужно создать.

### 2.1 Существующие таблицы (не менять, только читать/обновлять через API)

```sql
-- GEOLOCATION_CALLLOG — уже существует, ничего не создавать.
-- Приведено для справки психологической модели данных.
-- CREATE TABLE dbo.GEOLOCATION_CALLLOG (
--   ID              INT IDENTITY PRIMARY KEY,
--   DELETED         INT NOT NULL DEFAULT 0,
--   RECORD_VERSION  INT NOT NULL DEFAULT 0,
--   FNAME           NVARCHAR(200),
--   PHONE           NVARCHAR(50),
--   COMMENTS        NVARCHAR(MAX),
--   PHOTO           NVARCHAR(400),   -- имя файла, полный URL = PHOTO_BASE_URL + PHOTO
--   IP              NVARCHAR(64),
--   CLOSED          INT NOT NULL DEFAULT 0,   -- 0 = открыто, 1 = закрыто
--   XWGS FLOAT, YWGS FLOAT, ZWGS FLOAT,       -- GPS: широта, долгота, высота
--   DDATE           DATETIME2,
--   PLOT_NAME       INT,   -- FK -> GEOLOCATION_PLOT_NAMES.ID  [ДОПУЩЕНИЕ, см. ниже]
--   INDICATOR       INT,   -- FK -> GEOLOCATION_INDICATORS.ID  [ДОПУЩЕНИЕ, см. ниже]
--   LEVEL           INT    -- FK -> GEOLOCATION_LEVELS.ID      [ДОПУЩЕНИЕ, см. ниже]
-- );
-- GEOLOCATION_ACTIONS(ID, DELETED, TODO, DATE, PHOTO, CALLLOGID -> CALLLOG.ID)
-- GEOLOCATION_FIXED_RISKS(ID, DELETED, RECORD_VERSION, FIXED_RISK)
-- GEOLOCATION_INDICATORS(ID, DELETED, RECORD_VERSION, INDICATOR, FIXED_RISK -> FIXED_RISKS.ID)
-- GEOLOCATION_LEVELS(ID, DELETED, RECORD_VERSION, LEVEL)
-- GEOLOCATION_PLOT_NAMES(ID, DELETED, RECORD_VERSION, PLOT_NAME)
```

> **⚠️ Допущение, требующее проверки у IT перед подключением API:**
> в выгрузке видно, что `GEOLOCATION_INDICATORS.FIXED_RISK` — целое число
> (1..4), которое ссылается на `GEOLOCATION_FIXED_RISKS.ID`. По аналогии
> панель считает, что `CALLLOG.PLOT_NAME`, `CALLLOG.INDICATOR`,
> `CALLLOG.LEVEL` — тоже целочисленные внешние ключи на соответствующие
> справочники, а не текст. Если на самом деле там хранится текст —
> нужно поправить только маппинг в `data.js` (функция `decorateCallLog`),
> остальной код панели не изменится.

### 2.2 Новые таблицы (создать)

Двух справочников — «Уведомления» и «Контакты» — в текущей БД ещё нет.
DDL ниже выдержан в стиле уже существующих таблиц (`ID/DELETED/RECORD_VERSION`,
soft-delete через `DELETED`).

```sql
CREATE TABLE dbo.GEOLOCATION_NOTIFICATIONS (
  ID              INT IDENTITY PRIMARY KEY,
  DELETED         INT NOT NULL DEFAULT 0,
  RECORD_VERSION  INT NOT NULL DEFAULT 0,
  FIXED_RISK      INT NOT NULL REFERENCES dbo.GEOLOCATION_FIXED_RISKS(ID),
  LEVEL           INT NULL REFERENCES dbo.GEOLOCATION_LEVELS(ID)  -- NULL = все уровни этого риска
);

CREATE TABLE dbo.GEOLOCATION_NOTIFICATION_RECIPIENTS (
  ID                INT IDENTITY PRIMARY KEY,
  DELETED           INT NOT NULL DEFAULT 0,
  NOTIFICATION_ID   INT NOT NULL REFERENCES dbo.GEOLOCATION_NOTIFICATIONS(ID),
  EMAIL             NVARCHAR(200) NOT NULL
);

CREATE TABLE dbo.GEOLOCATION_CONTACTS (
  ID              INT IDENTITY PRIMARY KEY,
  DELETED         INT NOT NULL DEFAULT 0,
  RECORD_VERSION  INT NOT NULL DEFAULT 0,
  FNAME           NVARCHAR(200) NOT NULL,
  POSITION        NVARCHAR(200),
  PHONE           NVARCHAR(50),
  EMAIL           NVARCHAR(200)
);
```

### 2.3 Отправка e-mail при новом обращении

Таблица `GEOLOCATION_NOTIFICATIONS` только **хранит настройку**, кому
писать. Сама отправка письма — отдельная серверная задача: при вставке
новой строки в `GEOLOCATION_CALLLOG` (т.е. когда с телефона пришла форма)
нужно найти подходящую запись в `GEOLOCATION_NOTIFICATIONS` (по
`FIXED_RISK`, и по `LEVEL`, если он задан) и отправить письмо получателям
из `GEOLOCATION_NOTIFICATION_RECIPIENTS` через SMTP-сервер предприятия.
Это должно быть частью нового API (или SQL Server триггер + внешняя
задача) — фронтенд этого сделать не может.

## 3. Контракт REST API

Формат: JSON, `Content-Type: application/json`. Ниже — путь, метод и
пример тела запроса/ответа для каждого метода, которым уже пользуется
`data.js` (`RiskApi`). Реализовать нужно ровно этот набор — тогда в
`config.js` достаточно прописать `API_BASE_URL`, и весь остальной код
панели трогать не придётся.

| Метод и путь | Назначение | Тело запроса | Ответ |
|---|---|---|---|
| `GET /calllog` | список обращений (с расшифровкой риска/индикатора/уровня/участка) | — | `[{id, fname, phone, comments, photo, ip, closed, xwgs, ywgs, zwgs, ddate, plotNameId, plotName, indicatorId, indicator, fixedRiskId, fixedRisk, levelId, level}, ...]` |
| `GET /calllog/:id` | одно обращение | — | тот же объект, что в списке |
| `GET /calllog/:id/actions` | история действий по обращению | — | `[{id, todo, date, photo, calllogId}, ...]` |
| `POST /calllog/:id/close` | закрыть обращение | `{todo, photo}` (`photo` — base64 data URL или уже загруженный файл) | созданная запись действия |
| `POST /calllog/:id/reopen` | вернуть в статус «открыто» | — | `204` |
| `GET /plot-names` `POST /plot-names` `PUT /plot-names/:id` `DELETE /plot-names/:id` | справочник участков | `{plotName}` | запись/список |
| `GET /fixed-risks` `POST /fixed-risks` `PUT .../:id` `DELETE .../:id` | справочник рисков | `{fixedRisk}` | запись/список |
| `GET /levels` `POST /levels` `PUT .../:id` `DELETE .../:id` | справочник уровней | `{level}` | запись/список |
| `GET /indicators` `POST /indicators` `PUT .../:id` `DELETE .../:id` | справочник индикаторов | `{indicator, fixedRisk}` | запись/список |
| `GET /notifications` | список настроек уведомлений (с email-получателями) | — | `[{id, fixedRiskId, fixedRisk, levelId, level, recipients:[email,...]}, ...]` |
| `POST /notifications` | создать/обновить (если передан `id`) | `{id?, fixedRisk, level, recipients:[email,...]}` | запись |
| `DELETE /notifications/:id` | удалить | — | `204` |
| `GET /contacts` `POST /contacts` `PUT .../:id` `DELETE .../:id` | справочник контактов | `{fname, position, phone, email}` | запись/список |

Все `DELETE` — это soft-delete (`UPDATE ... SET DELETED = 1`), а не
физическое удаление строки — так же, как это уже сделано в существующих
таблицах.

## 4. Аутентификация

Для тестового периода достаточно простого API-ключа:
браузер отправляет заголовок `Authorization: Bearer <ключ>`
(панель уже поддерживает это — см. `config.js` → `API_KEY`).
Ключ проверяется API перед любым запросом к БД.

Для продакшена лучше завести отдельного технического пользователя SQL
Server с правами только на таблицы `GEOLOCATION_*` (не `sa`), и,
если на предприятии есть корпоративный SSO/AD — сделать вход в панель
через него, а не через статический ключ.

## 5. CORS

Если панель и API окажутся на разных доменах — на стороне API нужно
разрешить запросы с домена, где будет размещена панель:
```
Access-Control-Allow-Origin: https://<домен-панели>
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Allow-Methods: GET, POST, PUT, DELETE
```
Проще всего этого избежать — разместить панель на том же домене
(`geoadmin.rggold.kz/admin/` или похожем), тогда CORS не понадобится.

## 6. Пример реализации одного эндпоинта (для ориентира IT)

Node.js + пакет `mssql` (самый быстрый способ поднять такой API, если
сервер уже настроен на приём подключений по TCP 1433):

```js
const sql = require('mssql');
const config = { server: '...', database: '...', user: '...', password: '...' };

app.get('/api/fixed-risks', async (req, res) => {
  const pool = await sql.connect(config);
  const result = await pool.request()
    .query('SELECT ID as id, FIXED_RISK as fixedRisk FROM dbo.GEOLOCATION_FIXED_RISKS WHERE DELETED = 0');
  res.json(result.recordset);
});
```

На .NET (если стек предприятия — Windows/ASP.NET, что вероятно, раз
существующее приложение — десктопное с прямым SQL-подключением) —
аналогичный минимальный Web API endpoint с `SqlConnection`/Dapper даст
тот же результат.

## 7. Как переключить панель на боевые данные

Один файл — `risk-inspection/config.js`:

```js
window.RISK_CONFIG = {
  API_BASE_URL: 'https://geoadmin.rggold.kz/api', // было null
  PHOTO_BASE_URL: 'https://geoadmin.rggold.kz/static/files/',
  API_KEY: '...',
};
```

После этого `data.js` сам начинает ходить в сеть вместо localStorage —
никакой другой код (`ui-*.js`) менять не нужно.

## 8. Чек-лист для передачи в IT

1. Подтвердить/поправить допущение о типах полей `CALLLOG.PLOT_NAME`,
   `.INDICATOR`, `.LEVEL` (раздел 2.1).
2. Создать 3 новые таблицы из раздела 2.2.
3. Поднять REST API (Node/.NET/что угодно) с эндпоинтами из раздела 3,
   на том же сервере/сети, где стоит SQL Server.
4. Организовать отправку e-mail при новом обращении (раздел 2.3).
5. Выдать технический доступ (пункт 4) и сообщить `API_BASE_URL` + ключ.
6. Прописать их в `config.js`, задеплоить `risk-inspection/` рядом с
   формой на `geoadmin.rggold.kz` (или на любой статический хостинг,
   если CORS настроен).
