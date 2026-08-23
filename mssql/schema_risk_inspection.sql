-- ============================================================
--  Risk-inspection (Инспекция участков) — новые таблицы для MS SQL
--  База: GeoLocation (сервер RAYWEBV04), схема dbo
--
--  Источник: risk-inspection/BACKEND_INTEGRATION.md, раздел 2.2.
--  DDL взят оттуда практически без изменений — под этот контракт
--  уже написан и проверен клиентский код (data.js), менять его не нужно.
--
--  ВАЖНО: следующие таблицы УЖЕ СУЩЕСТВУЮТ на сервере и этим скриптом
--  не создаются и не трогаются (см. BACKEND_INTEGRATION.md §2.1):
--    GEOLOCATION_CALLLOG, GEOLOCATION_ACTIONS, GEOLOCATION_FIXED_RISKS,
--    GEOLOCATION_INDICATORS, GEOLOCATION_LEVELS, GEOLOCATION_PLOT_NAMES
--
--  ⚠ Перед запуском нужно у IT подтвердить допущение (BACKEND_INTEGRATION.md §2.1):
--  что CALLLOG.PLOT_NAME / .INDICATOR / .LEVEL — целочисленные внешние
--  ключи на соответствующие справочники (а не текст). Если это не так —
--  сам этот скрипт не пострадает (он их не трогает), но нужно будет
--  поправить backend/data.js.
--
--  Запуск: один раз на базе GeoLocation. Идемпотентно.
-- ============================================================

USE GeoLocation;
GO

IF OBJECT_ID('dbo.GEOLOCATION_NOTIFICATIONS', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.GEOLOCATION_NOTIFICATIONS (
    ID              INT IDENTITY PRIMARY KEY,
    DELETED         INT NOT NULL DEFAULT 0,
    RECORD_VERSION  INT NOT NULL DEFAULT 0,
    FIXED_RISK      INT NOT NULL REFERENCES dbo.GEOLOCATION_FIXED_RISKS(ID),
    LEVEL           INT NULL REFERENCES dbo.GEOLOCATION_LEVELS(ID)  -- NULL = все уровни этого риска
  );
END
GO

IF OBJECT_ID('dbo.GEOLOCATION_NOTIFICATION_RECIPIENTS', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.GEOLOCATION_NOTIFICATION_RECIPIENTS (
    ID                INT IDENTITY PRIMARY KEY,
    DELETED           INT NOT NULL DEFAULT 0,
    NOTIFICATION_ID   INT NOT NULL REFERENCES dbo.GEOLOCATION_NOTIFICATIONS(ID),
    EMAIL             NVARCHAR(200) NOT NULL
  );
END
GO

IF OBJECT_ID('dbo.GEOLOCATION_CONTACTS', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.GEOLOCATION_CONTACTS (
    ID              INT IDENTITY PRIMARY KEY,
    DELETED         INT NOT NULL DEFAULT 0,
    RECORD_VERSION  INT NOT NULL DEFAULT 0,
    FNAME           NVARCHAR(200) NOT NULL,
    POSITION        NVARCHAR(200) NULL,
    PHONE           NVARCHAR(50)  NULL,
    EMAIL           NVARCHAR(200) NULL
  );
END
GO

-- Схема участка за конкретную неделю. Ключ — PLOT_NAME + WEEK_KEY:
-- раз в неделю грузится новая строка, старые недели остаются в истории.
IF OBJECT_ID('dbo.GEOLOCATION_SCHEMES', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.GEOLOCATION_SCHEMES (
    ID              INT IDENTITY PRIMARY KEY,
    DELETED         INT NOT NULL DEFAULT 0,
    RECORD_VERSION  INT NOT NULL DEFAULT 0,
    PLOT_NAME       INT NOT NULL REFERENCES dbo.GEOLOCATION_PLOT_NAMES(ID),
    WEEK_KEY        CHAR(8) NOT NULL,        -- напр. "2026-W29"
    IMAGE           NVARCHAR(400) NOT NULL,  -- имя файла; полный URL = PHOTO_BASE_URL + IMAGE
    X_MIN           FLOAT NULL,
    X_MAX           FLOAT NULL,
    Y_MIN           FLOAT NULL,
    Y_MAX           FLOAT NULL,
    UPLOADED_AT     DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UPLOADED_BY     NVARCHAR(200) NULL
  );
  -- Не должно быть двух одновременно активных схем на одну пару участок+неделя
  CREATE UNIQUE INDEX UX_SCHEMES_PLOT_WEEK_ACTIVE
    ON dbo.GEOLOCATION_SCHEMES(PLOT_NAME, WEEK_KEY) WHERE DELETED = 0;
END
GO

-- Разломы (линии) — геологический слой на карте участка
IF OBJECT_ID('dbo.GEOLOCATION_FAULTS', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.GEOLOCATION_FAULTS (
    ID              INT IDENTITY PRIMARY KEY,
    DELETED         INT NOT NULL DEFAULT 0,
    RECORD_VERSION  INT NOT NULL DEFAULT 0,
    PLOT_NAME       INT NOT NULL REFERENCES dbo.GEOLOCATION_PLOT_NAMES(ID),
    NAME            NVARCHAR(200) NULL,
    POINTS          NVARCHAR(MAX) NOT NULL,  -- JSON: [[x,y], ...], минимум 2 точки
    CREATED_AT      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CREATED_BY      NVARCHAR(200) NULL
  );
END
GO

-- Домены (полигоны) — геологический слой на карте участка
IF OBJECT_ID('dbo.GEOLOCATION_DOMAINS', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.GEOLOCATION_DOMAINS (
    ID              INT IDENTITY PRIMARY KEY,
    DELETED         INT NOT NULL DEFAULT 0,
    RECORD_VERSION  INT NOT NULL DEFAULT 0,
    PLOT_NAME       INT NOT NULL REFERENCES dbo.GEOLOCATION_PLOT_NAMES(ID),
    NAME            NVARCHAR(200) NOT NULL,
    COLOR           CHAR(7) NOT NULL DEFAULT '#1a73e8',
    POINTS          NVARCHAR(MAX) NOT NULL,  -- JSON: [[x,y], ...], минимум 3 точки
    CREATED_AT      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CREATED_BY      NVARCHAR(200) NULL
  );
END
GO

-- Настраиваемые цвета раскраски карты (уровень/риск/разлом)
IF OBJECT_ID('dbo.GEOLOCATION_COLOR_SETTINGS', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.GEOLOCATION_COLOR_SETTINGS (
    ID          INT IDENTITY PRIMARY KEY,
    TARGET_TYPE VARCHAR(10) NOT NULL,  -- 'level' | 'risk' | 'fault'
    TARGET_ID   INT NULL,              -- FK на LEVELS/FIXED_RISKS.ID, NULL для 'fault'
    COLOR       CHAR(7) NOT NULL
  );
  CREATE UNIQUE INDEX UX_COLOR_SETTINGS_TARGET
    ON dbo.GEOLOCATION_COLOR_SETTINGS(TARGET_TYPE, TARGET_ID);
END
GO
