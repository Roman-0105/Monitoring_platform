# Подключение админ-панели «Инспекция участков» к производственной базе данных

Этот документ — то, что нужно передать IT-отделу предприятия, чтобы
перевести панель из тестового режима (локальные мок-данные в браузере)
в производственный режим (реальные данные из SQL Server).

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

-- Схема (план участка) за конкретную неделю: ключ — PLOT_NAME + WEEK_KEY,
-- а не просто PLOT_NAME. Каждую неделю грузится НОВАЯ строка, старые
-- недели остаются в истории (доступны в UI через выбор недели), а не
-- затираются. WEEK_KEY — тот же формат, что <input type="week"> отдаёт
-- в браузере: "2026-W29" (год-Wномер недели).
CREATE TABLE dbo.GEOLOCATION_SCHEMES (
  ID              INT IDENTITY PRIMARY KEY,
  DELETED         INT NOT NULL DEFAULT 0,
  RECORD_VERSION  INT NOT NULL DEFAULT 0,
  PLOT_NAME       INT NOT NULL REFERENCES dbo.GEOLOCATION_PLOT_NAMES(ID),
  WEEK_KEY        CHAR(8) NOT NULL,        -- напр. "2026-W29"
  IMAGE           NVARCHAR(400) NOT NULL,  -- имя файла, как в CALLLOG.PHOTO — полный URL = PHOTO_BASE_URL + IMAGE
  X_MIN           FLOAT NULL,
  X_MAX           FLOAT NULL,
  Y_MIN           FLOAT NULL,
  Y_MAX           FLOAT NULL,
  UPLOADED_AT     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UPLOADED_BY     NVARCHAR(200) NULL
);

-- На одну и ту же пару "участок + неделя" не должно быть двух
-- одновременно активных схем — обеспечивает то же "одна схема на
-- участок-неделю", что уже реализовано в клиенте (upload на ту же
-- неделю заменяет существующую строку, а не плодит новые).
CREATE UNIQUE INDEX UX_SCHEMES_PLOT_WEEK_ACTIVE ON dbo.GEOLOCATION_SCHEMES(PLOT_NAME, WEEK_KEY) WHERE DELETED = 0;
```

> В тестовой модели изображение схемы хранится как base64 прямо в
> localStorage (`risk-inspection/data.js`, `RiskApi.schemes`) — из-за
> этого детальные PDF-схемы приходится ужимать сильнее (макс. 1600px,
> JPEG), чтобы не упереться в лимит браузера (~5-10 МБ на весь сайт). В
> производственном API этого ограничения нет: изображение, как и фото обращений,
> должно лежать файлом на сервере (тот же `geoadmin.rggold.kz/static/files/`),
> а `IMAGE` — хранить только имя файла, не сами байты. Ограничение
> размера тогда можно смягчить или снять совсем.

### 2.3 Отправка e-mail при новом обращении

Таблица `GEOLOCATION_NOTIFICATIONS` только **хранит настройку**, кому
писать. Сама отправка письма — отдельная серверная задача: при вставке
новой строки в `GEOLOCATION_CALLLOG` (т.е. когда с телефона пришла форма)
нужно найти подходящую запись в `GEOLOCATION_NOTIFICATIONS` (по
`FIXED_RISK`, и по `LEVEL`, если он задан) и отправить письмо получателям
из `GEOLOCATION_NOTIFICATION_RECIPIENTS` через SMTP-сервер предприятия.
Это должно быть частью нового API (или SQL Server триггер + внешняя
задача) — фронтенд этого сделать не может.

### 2.4 Полная логика записи/изменения/удаления схемы на сервере

Схема живёт по паре **участок + неделя** (`WEEK_KEY`), не просто по
участку — раз в неделю грузится новый файл, старые недели остаются в
истории. Ниже — что должен делать конкретно этот блок API, три операции,
завязанные и на файл на диске, и на строку в БД:

**Создание / замена изображения — `POST /schemes/:plotId/:weekKey`**
1. Проверить, что `plotId` существует в `GEOLOCATION_PLOT_NAMES` (иначе `404`).
2. Сохранить присланный файл на диск/файловый сервер (тот же принцип,
   что и для фото обращений — уникальное имя, например
   `scheme_<plotId>_<weekKey>_<timestamp>.jpg`).
3. Найти существующую строку `GEOLOCATION_SCHEMES` для этой пары
   `WHERE PLOT_NAME = :plotId AND WEEK_KEY = :weekKey AND DELETED = 0`:
   - если есть (повторная загрузка **той же** недели) — **удалить со
     диска старый файл** (по старому значению `IMAGE`), обновить `IMAGE`,
     `UPLOADED_AT`, `UPLOADED_BY`, `RECORD_VERSION += 1`. Границы
     (`X_MIN..Y_MAX`) не трогать — калибровка обычно остаётся актуальной,
     если новый скан того же масштаба;
   - если нет (**новая** неделя для этого участка) — найти последнюю по
     дате строку для этого `plotId` (`ORDER BY WEEK_KEY DESC`) и
     **скопировать её `X_MIN..Y_MAX`** в новую строку вместо `NULL` —
     так админ не перекалибровывает схему с нуля каждую неделю, если
     рамка съёмки не меняется (он может поправить границы вручную,
     если конкретно на этой неделе рамка съехала). Если для участка
     схем ещё не было вообще — `X_MIN..Y_MAX = NULL`.
4. **Не** удалять старый файл (в пункте "та же неделя"), пока новый не
   записан успешно (сначала пишем новый, потом чистим старый) — если
   что-то упадёт посередине, не должно быть ситуации "старого файла уже
   нет, а нового ещё нет".

**Изменение границ — `PUT /schemes/:plotId/:weekKey/bounds`**
Просто `UPDATE X_MIN, X_MAX, Y_MIN, Y_MAX, RECORD_VERSION += 1
WHERE PLOT_NAME = :plotId AND WEEK_KEY = :weekKey AND DELETED = 0`. Если
строки нет — `404` ("сначала загрузите изображение на эту неделю", как
и в клиенте).

**Удаление — `DELETE /schemes/:plotId/:weekKey`**
1. `UPDATE GEOLOCATION_SCHEMES SET DELETED = 1 WHERE PLOT_NAME = :plotId AND WEEK_KEY = :weekKey AND DELETED = 0`
   (soft-delete строки, как и везде в этой БД) — удаляется только схема
   этой конкретной недели, остальные недели участка не затрагиваются.
2. Физически удалить файл изображения с диска — иначе файлы будут
   бесконечно копиться на сервере при повторных загрузках/удалениях.
3. Вернуть `204`. Клиент после этого покажет на карте за эту неделю
   состояние "схема не загружена" — точки участка за эту неделю
   временно не отображаются, пока не загрузят схему заново (это
   ожидаемое поведение, не баг).

**Права доступа.** Все три операции — административные и деструктивные
(особенно `DELETE` и замена картинки в `POST`, которая тоже стирает
предыдущий файл) — не должны быть доступны без авторизации даже в
тестовом режиме с API-ключом (раздел 4). Это не то же самое, что запись
в `GEOLOCATION_CALLLOG` с мобильной формы, куда пишет кто угодно по QR.

**Конкуренция.** Если два администратора одновременно откроют
калибровку одной и той же схемы — на данном этапе (небольшая команда,
редкие изменения) можно просто позволить "кто сохранил последним, тот
и победил". Если захочется строже — API может сверять переданный
клиентом `RECORD_VERSION` с текущим в БД и отвечать `409 Conflict`,
если кто-то уже успел сохранить изменения между чтением и записью;
клиент (`RiskApi.schemes`) сейчас `RECORD_VERSION` не отправляет — это
пришлось бы добавить в `data.js` заодно.

**Фильтр точек обращений по неделе.** Отдельного поля "неделя" у
`GEOLOCATION_CALLLOG` нет и не нужно — у обращения уже есть `DDATE`.
Точки на карте фильтруются пересчётом `DDATE` в тот же формат `WEEK_KEY`
на лету (в браузере, см. `weekKeyForDate()` в `risk-inspection/ui-utils.js`)
и сравнением с выбранной неделей — это не требует изменений в API,
`GET /calllog` как отдавал полный список, так и отдаёт.

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
| `PUT /calllog/:id` | редактирование полей обращения администратором | `{fname, phone, comments, plotName, indicator, level, ddate, xwgs, ywgs, zwgs, xLocal, yLocal}` | обновлённая запись |
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
| `GET /schemes/:plotId/weeks` | список всех загруженных недель схемы для участка, от новой к старой | — | `[{id, plotName, weekKey, image, xMin, xMax, yMin, yMax, uploadedAt, uploadedBy}, ...]` |
| `GET /schemes/:plotId/latest` | самая свежая загруженная неделя для участка (или `null`) | — | тот же объект, что в списке недель |
| `GET /schemes/:plotId/:weekKey` | схема конкретной недели (или `null`) | — | тот же объект, что в списке недель |
| `POST /schemes/:plotId/:weekKey` | загрузить/заменить изображение схемы этой недели (замена — со старым файлом на диске; новая неделя — с переносом границ с прошлой, см. раздел 2.4) | `{image, uploadedBy}` (base64 или уже загруженный файл) | запись |
| `PUT /schemes/:plotId/:weekKey/bounds` | сохранить границы координат этой недели (ручной ввод или расчёт калибровки) | `{xMin, xMax, yMin, yMax}` | запись |
| `DELETE /schemes/:plotId/:weekKey` | удалить схему этой недели (см. раздел 2.4 — включая файл на диске); другие недели участка не затрагивает | — | `204` |

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

## 7. Как переключить панель на производственные данные

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
2. Создать 4 новые таблицы из раздела 2.2 (включая `GEOLOCATION_SCHEMES`).
3. Поднять REST API (Node/.NET/что угодно) с эндпоинтами из раздела 3,
   на том же сервере/сети, где стоит SQL Server.
4. Для схем — реализовать именно логику из раздела 2.4 (замена файла на
   диске при повторной загрузке, удаление файла при `DELETE`), не только
   CRUD в БД — иначе диск будет копить неиспользуемые изображения.
5. Организовать отправку e-mail при новом обращении (раздел 2.3).
6. Убедиться, что операции загрузки/удаления схемы доступны только
   авторизованным администраторам панели, а не всем подряд.
7. Выдать технический доступ (раздел 4) и сообщить `API_BASE_URL` + ключ.
8. Прописать их в `config.js`, задеплоить `risk-inspection/` рядом с
   формой на `geoadmin.rggold.kz` (или на любой статический хостинг,
   если CORS настроен).
