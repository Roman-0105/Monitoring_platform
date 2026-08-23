-- ============================================================
--  Гидрогеологический мониторинг — схема для MS SQL Server
--  База: GeoLocation  (сервер RAYWEBV04)
--
--  Это перевод схемы Supabase/Postgres (hydro-monitoring/supabase/*.sql
--  + hydro-monitoring/*migration*.sql, hydro-monitoring/migrations/*.sql)
--  в T-SQL, сразу в финальном виде (все миграции уже применены к структуре).
--
--  Отличия от Postgres-версии:
--   - RLS/policies убраны — проверки прав переехали в backend (Node.js API),
--     который читает личность пользователя из Windows-аутентификации IIS.
--   - jsonb / text[]  -> NVARCHAR(MAX) с JSON-текстом внутри
--     (SQL Server умеет работать с таким через ISJSON/JSON_VALUE/OPENJSON).
--   - uuid  -> UNIQUEIDENTIFIER DEFAULT NEWID()
--   - timestamptz -> DATETIME2 (храним время в UTC по соглашению)
--   - now() -> SYSUTCDATETIME()
--   - Таблица water_points не создаётся: в проекте она уже заменена на
--     wp_registry (см. hydro-monitoring/migrations/unify_water_points.sql).
--   - Вместо profiles + is_admin() — таблица APP_USERS(login, role),
--     которую backend использует для проверки "администратор / обычный".
--
--  Запуск: выполнить целиком один раз на базе GeoLocation
--  (например через SSMS или sqlcmd). Скрипт идемпотентный —
--  повторный запуск ничего не сломает.
-- ============================================================

USE GeoLocation;
GO

-- ────────────────────────────────────────────────────────────
-- Пользователи приложения (замена Supabase profiles + is_admin())
-- login — Windows-логин вида DOMAIN\username, который IIS передаёт backend'у
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.APP_USERS', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.APP_USERS (
    login        NVARCHAR(100) NOT NULL PRIMARY KEY,
    display_name NVARCHAR(200) NOT NULL DEFAULT '',
    role         NVARCHAR(20)  NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
    active       BIT           NOT NULL DEFAULT 1,
    created_at   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

-- ────────────────────────────────────────────────────────────
-- 1. points — замеры в точках наблюдения
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.points', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.points (
    id              NVARCHAR(100)  NOT NULL PRIMARY KEY,
    point_number    NVARCHAR(400)  NOT NULL DEFAULT '',
    monitoring_date DATE           NULL,
    worker          NVARCHAR(400)  NOT NULL DEFAULT '',
    lat             FLOAT          NULL,
    lon             FLOAT          NULL,
    x_local         FLOAT          NULL,
    y_local         FLOAT          NULL,
    status          NVARCHAR(100)  NOT NULL DEFAULT N'Новая',
    intensity       NVARCHAR(400)  NOT NULL DEFAULT '',
    flow_rate       FLOAT          NULL,
    water_color     NVARCHAR(400)  NOT NULL DEFAULT '',
    wall            NVARCHAR(400)  NOT NULL DEFAULT '',
    domain          NVARCHAR(400)  NOT NULL DEFAULT '',
    measure_method  NVARCHAR(400)  NOT NULL DEFAULT '',
    horizon         NVARCHAR(400)  NOT NULL DEFAULT '',
    comment         NVARCHAR(MAX)  NOT NULL DEFAULT '',
    photos          NVARCHAR(MAX)  NOT NULL DEFAULT '[]',  -- JSON-массив URL
    created_at      DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX points_point_number_idx    ON dbo.points(point_number);
  CREATE INDEX points_monitoring_date_idx ON dbo.points(monitoring_date DESC);
  CREATE INDEX points_status_idx          ON dbo.points(status);
END
GO

-- ────────────────────────────────────────────────────────────
-- 2. ditches — замеры канав
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.ditches', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ditches (
    id              NVARCHAR(100)  NOT NULL PRIMARY KEY,
    point_number    NVARCHAR(400)  NOT NULL DEFAULT '',
    ditch_name      NVARCHAR(400)  NOT NULL DEFAULT '',
    monitoring_date DATE           NULL,
    worker          NVARCHAR(400)  NOT NULL DEFAULT '',
    lat             FLOAT          NULL,
    lon             FLOAT          NULL,
    x_local         FLOAT          NULL,
    y_local         FLOAT          NULL,
    status          NVARCHAR(100)  NOT NULL DEFAULT N'Активная',
    width           FLOAT          NULL,
    vel_method      NVARCHAR(100)  NOT NULL DEFAULT 'single',
    velocity        FLOAT          NULL,
    float_l         FLOAT          NULL,
    float_t         FLOAT          NULL,
    float_k         FLOAT          NULL,
    dist_mode       NVARCHAR(100)  NOT NULL DEFAULT 'u',
    n_points        INT            NULL,
    depths          NVARCHAR(MAX)  NOT NULL DEFAULT '[]',  -- JSON-массив
    dists           NVARCHAR(MAX)  NOT NULL DEFAULT '[]',  -- JSON-массив
    area            FLOAT          NULL,
    flow_m3h        FLOAT          NULL,
    comment         NVARCHAR(MAX)  NOT NULL DEFAULT '',
    photos          NVARCHAR(MAX)  NOT NULL DEFAULT '[]',  -- JSON-массив URL
    created_at      DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX ditches_point_number_idx ON dbo.ditches(point_number);
  CREATE INDEX ditches_ditch_name_idx   ON dbo.ditches(ditch_name);
  CREATE INDEX ditches_date_idx         ON dbo.ditches(monitoring_date DESC);
END
GO

-- ────────────────────────────────────────────────────────────
-- 3. workers — сотрудники
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.workers', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.workers (
    id         NVARCHAR(100) NOT NULL PRIMARY KEY,
    name       NVARCHAR(400) NOT NULL,
    active     BIT           NOT NULL DEFAULT 1,
    created_at DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

-- ────────────────────────────────────────────────────────────
-- 4. schemes — недельные схемы карьера (изображения)
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.schemes', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.schemes (
    week_key     NVARCHAR(100) NOT NULL PRIMARY KEY,
    storage_path NVARCHAR(1000) NOT NULL,
    uploaded_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    uploaded_by  NVARCHAR(400) NOT NULL DEFAULT ''
  );
END
GO

-- ────────────────────────────────────────────────────────────
-- 5. wells — реестр горизонтальных скважин
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.wells', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.wells (
    id               NVARCHAR(100)  NOT NULL PRIMARY KEY,
    name             NVARCHAR(400)  NOT NULL DEFAULT '',
    domain           NVARCHAR(400)  NOT NULL DEFAULT '',
    depth            FLOAT          NULL,
    inclination      FLOAT          NULL,
    azimuth          FLOAT          NULL,
    drill_diameter   FLOAT          NULL,
    casing           NVARCHAR(400)  NOT NULL DEFAULT '',
    drill_date       DATE           NULL,
    has_wellhead     BIT            NOT NULL DEFAULT 0,
    flow_after_drill FLOAT          NULL,
    x_local          FLOAT          NULL,
    y_local          FLOAT          NULL,
    z_local          FLOAT          NULL,
    lat              FLOAT          NULL,
    lon              FLOAT          NULL,
    quarry           NVARCHAR(400)  NOT NULL DEFAULT '',
    quarry_section   NVARCHAR(400)  NOT NULL DEFAULT '',
    status           NVARCHAR(100)  NOT NULL DEFAULT N'Активная'
                       CHECK (status IN (N'Активная', N'Иссякает', N'Сухая')),
    created_at       DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX wells_name_idx       ON dbo.wells(name);
  CREATE INDEX wells_drill_date_idx ON dbo.wells(drill_date DESC);
END
GO

-- ────────────────────────────────────────────────────────────
-- 6. well_measurements — замеры дебита скважин
-- Запись/изменение/удаление — только для роли admin (проверяется в backend)
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.well_measurements', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.well_measurements (
    id                NVARCHAR(100) NOT NULL PRIMARY KEY,
    well_id           NVARCHAR(100) NOT NULL,
    measurement_date  DATE          NULL,
    flow_rate         FLOAT         NULL,
    worker            NVARCHAR(400) NOT NULL DEFAULT '',
    comment           NVARCHAR(MAX) NOT NULL DEFAULT '',
    created_at        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_well_measurements_well FOREIGN KEY (well_id)
      REFERENCES dbo.wells(id) ON DELETE CASCADE
  );
  CREATE INDEX well_meas_well_id_idx ON dbo.well_measurements(well_id);
  CREATE INDEX well_meas_date_idx    ON dbo.well_measurements(measurement_date DESC);
END
GO

-- ────────────────────────────────────────────────────────────
-- 7. wp_registry — единый реестр водопунктов (скважины, зумпфы, пруды…)
-- (заменяет старую water_points — она в проект больше не переносится)
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.wp_registry', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.wp_registry (
    id                UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
    wp_type           NVARCHAR(50)   NOT NULL DEFAULT 'other',
                        -- well_obs | well_exp | sump | pond | seep | ditch | other
    name              NVARCHAR(400)  NOT NULL,
    code              NVARCHAR(200)  NULL,
    coord_x           DECIMAL(12,3)  NULL,
    coord_y           DECIMAL(12,3)  NULL,
    lat               DECIMAL(10,6)  NULL,
    lng               DECIMAL(10,6)  NULL,
    depth             DECIMAL(8,2)   NULL,
    diameter          DECIMAL(8,1)   NULL,
    filter_from       DECIMAL(8,2)   NULL,
    filter_to         DECIMAL(8,2)   NULL,
    aquifer           NVARCHAR(400)  NULL,
    drilled_at        DATE           NULL,
    pump_model        NVARCHAR(400)  NULL,
    pump_depth        DECIMAL(8,2)   NULL,
    pump_capacity     DECIMAL(8,2)   NULL,
    pump_head         DECIMAL(8,2)   NULL,
    notes             NVARCHAR(MAX)  NULL,
    active            BIT            NOT NULL DEFAULT 1,
    location_desc     NVARCHAR(MAX)  NULL,
    elev_z            DECIMAL(10,3)  NULL,
    drill_company     NVARCHAR(400)  NULL,
    drill_date_start  DATE           NULL,
    drill_date_end    DATE           NULL,
    filter_intervals  NVARCHAR(MAX)  NOT NULL DEFAULT '[]',  -- JSON [{from,to,diameter}]
    drill_intervals   NVARCHAR(MAX)  NOT NULL DEFAULT '[]',  -- JSON [{from,to,diameter}]
    casing_intervals  NVARCHAR(MAX)  NOT NULL DEFAULT '[]',  -- JSON [{from,to,diameter}]
    created_at        DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX idx_wp_registry_type ON dbo.wp_registry(wp_type);
END
GO

-- ────────────────────────────────────────────────────────────
-- 8. chem_protocols — протоколы химического анализа воды
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.chem_protocols', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.chem_protocols (
    id                  UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
    water_point_id       UNIQUEIDENTIFIER NULL,
    protocol_type        NVARCHAR(50)   NOT NULL DEFAULT 'full',
                           -- full | radio_gen | radio_ext | cyanide | micro
    lab_name              NVARCHAR(400)  NULL,
    lab_protocol_number   NVARCHAR(200)  NULL,
    lab_order_number      NVARCHAR(200)  NULL,
    lab_number            NVARCHAR(200)  NULL,
    sample_name           NVARCHAR(400)  NULL,
    sampled_at             DATE          NOT NULL,
    received_at            DATE          NULL,
    tested_from            DATE          NULL,
    tested_to              DATE          NULL,
    analysis_types          NVARCHAR(MAX) NULL,
    test_type                NVARCHAR(400) NULL,
    conditions                NVARCHAR(MAX) NULL,
    source                    NVARCHAR(50)  NOT NULL DEFAULT 'manual',  -- manual | excel
    notes                     NVARCHAR(MAX) NULL,
    is_control                BIT           NOT NULL DEFAULT 0,
    created_at                DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    created_by                NVARCHAR(400) NULL,
    CONSTRAINT FK_chem_protocols_wp FOREIGN KEY (water_point_id)
      REFERENCES dbo.wp_registry(id) ON DELETE SET NULL
  );
  CREATE INDEX idx_chem_protocols_wp   ON dbo.chem_protocols(water_point_id);
  CREATE INDEX idx_chem_protocols_date ON dbo.chem_protocols(sampled_at DESC);
END
GO

-- ────────────────────────────────────────────────────────────
-- 9. chem_results — результаты анализа, одна строка на параметр
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.chem_results', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.chem_results (
    id              UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
    protocol_id     UNIQUEIDENTIFIER NOT NULL,
    param_key       NVARCHAR(100)  NOT NULL,
    value_raw       NVARCHAR(400)  NULL,
    value_num       DECIMAL(18,6)  NULL,
    below_detection BIT            NOT NULL DEFAULT 0,
    above_range     BIT            NOT NULL DEFAULT 0,
    nd_ref          NVARCHAR(400)  NULL,
    CONSTRAINT FK_chem_results_protocol FOREIGN KEY (protocol_id)
      REFERENCES dbo.chem_protocols(id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX chem_results_proto_param ON dbo.chem_results(protocol_id, param_key);
  CREATE INDEX idx_chem_results_key ON dbo.chem_results(param_key);
END
GO

-- ────────────────────────────────────────────────────────────
-- 10. dew_sumps — зумпфы (водоотведение)
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.dew_sumps', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.dew_sumps (
    id              NVARCHAR(100) NOT NULL PRIMARY KEY,
    name            NVARCHAR(400) NOT NULL DEFAULT '',
    quarry          NVARCHAR(400) NOT NULL DEFAULT '',
    notes           NVARCHAR(MAX) NOT NULL DEFAULT '',
    tridb_path      NVARCHAR(1000) NULL,
    total_volume    FLOAT         NULL,
    z_min           FLOAT         NULL,
    z_max           FLOAT         NULL,
    critical_level  FLOAT         NULL,
    volume_curve    NVARCHAR(MAX) NULL,  -- JSON
    updated_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

-- ────────────────────────────────────────────────────────────
-- 11. dew_sump_curve_versions — версии кривых V(H) для зумпфов
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.dew_sump_curve_versions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.dew_sump_curve_versions (
    id           NVARCHAR(100) NOT NULL PRIMARY KEY,
    sump_id      NVARCHAR(100) NOT NULL,
    valid_from   DATE          NOT NULL,
    total_volume DECIMAL(18,3) NULL,
    z_min        DECIMAL(18,3) NULL,
    z_max        DECIMAL(18,3) NULL,
    tridb_path   NVARCHAR(1000) NULL,
    volume_curve NVARCHAR(MAX) NULL,  -- JSON
    notes        NVARCHAR(MAX) NOT NULL DEFAULT '',
    created_at   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_dew_curve_versions_sump FOREIGN KEY (sump_id)
      REFERENCES dbo.dew_sumps(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_dew_sump_curve_versions_sump_id  ON dbo.dew_sump_curve_versions(sump_id);
  CREATE INDEX idx_dew_sump_curve_versions_valid_from ON dbo.dew_sump_curve_versions(valid_from);
END
GO

-- ────────────────────────────────────────────────────────────
-- 12. dew_elevation_history — история уровней в зумпфах
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.dew_elevation_history', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.dew_elevation_history (
    id         NVARCHAR(100) NOT NULL PRIMARY KEY,
    sump_id    NVARCHAR(100) NOT NULL DEFAULT '',
    date       DATE          NULL,
    elevation  DECIMAL(18,3) NULL,
    notes      NVARCHAR(MAX) NOT NULL DEFAULT '',
    updated_at DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX idx_dew_elev_sump_id ON dbo.dew_elevation_history(sump_id);
  CREATE INDEX idx_dew_elev_date    ON dbo.dew_elevation_history(date DESC);
END
GO

-- ────────────────────────────────────────────────────────────
-- 13. dew_pumps — насосы
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.dew_pumps', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.dew_pumps (
    id                     NVARCHAR(100) NOT NULL PRIMARY KEY,
    sump_id                NVARCHAR(100) NOT NULL DEFAULT '',
    name                   NVARCHAR(400) NOT NULL DEFAULT '',
    model                  NVARCHAR(400) NOT NULL DEFAULT '',
    serial_number          NVARCHAR(400) NOT NULL DEFAULT '',
    inventory_number       NVARCHAR(400) NOT NULL DEFAULT '',
    quarry                 NVARCHAR(400) NOT NULL DEFAULT '',
    capacity               DECIMAL(18,3) NULL,
    head                   DECIMAL(18,3) NULL,
    type                   NVARCHAR(200) NOT NULL DEFAULT '',
    status                 NVARCHAR(50)  NOT NULL DEFAULT 'off',
    install_date           DATE          NULL,
    notes                  NVARCHAR(MAX) NOT NULL DEFAULT '',
    count_in_volume        BIT           NOT NULL DEFAULT 1,
    default_distributions  NVARCHAR(MAX) NOT NULL DEFAULT '[]',  -- JSON
    updated_at             DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX idx_dew_pumps_sump_id ON dbo.dew_pumps(sump_id);
  CREATE INDEX idx_dew_pumps_status  ON dbo.dew_pumps(status);
END
GO

-- ────────────────────────────────────────────────────────────
-- 14. dew_pump_events — установка/снятие насосов
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.dew_pump_events', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.dew_pump_events (
    id                NVARCHAR(100) NOT NULL PRIMARY KEY,
    sump_id           NVARCHAR(100) NOT NULL DEFAULT '',
    date              DATE          NULL,
    type              NVARCHAR(100) NOT NULL DEFAULT '',
    removed_pump_id   NVARCHAR(100) NULL,
    installed_pump_id NVARCHAR(100) NULL,
    reason            NVARCHAR(MAX) NOT NULL DEFAULT '',
    performed_by      NVARCHAR(400) NOT NULL DEFAULT '',
    notes             NVARCHAR(MAX) NOT NULL DEFAULT '',
    updated_at        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX idx_dew_pump_events_sump_id ON dbo.dew_pump_events(sump_id);
  CREATE INDEX idx_dew_pump_events_date    ON dbo.dew_pump_events(date DESC);
END
GO

-- ────────────────────────────────────────────────────────────
-- 15. dew_destinations — направления сброса воды
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.dew_destinations', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.dew_destinations (
    id             NVARCHAR(100) NOT NULL PRIMARY KEY,
    name           NVARCHAR(400) NOT NULL DEFAULT '',
    type           NVARCHAR(100) NOT NULL DEFAULT '',
    target_sump_id NVARCHAR(100) NULL,
    color          NVARCHAR(50)  NOT NULL DEFAULT '',
    updated_at     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

-- ────────────────────────────────────────────────────────────
-- 16. dew_meter_readings — показания счётчиков насосов
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.dew_meter_readings', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.dew_meter_readings (
    id                NVARCHAR(100) NOT NULL PRIMARY KEY,
    pump_id           NVARCHAR(100) NOT NULL DEFAULT '',
    date              DATE          NULL,
    reading           DECIMAL(18,3) NULL,
    is_reset          BIT           NOT NULL DEFAULT 0,
    is_stopped        BIT           NOT NULL DEFAULT 0,
    reset_start_value DECIMAL(18,3) NULL,
    downtime_reason   NVARCHAR(MAX) NOT NULL DEFAULT '',
    hours_worked      DECIMAL(18,3) NULL,
    distributions     NVARCHAR(MAX) NOT NULL DEFAULT '[]',  -- JSON
    is_manual_volume  BIT           NOT NULL DEFAULT 0,
    manual_volume     DECIMAL(18,3) NULL,
    notes             NVARCHAR(MAX) NOT NULL DEFAULT '',
    updated_at        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX idx_dew_meter_readings_pump_date ON dbo.dew_meter_readings(pump_id, date DESC);
END
GO

-- ────────────────────────────────────────────────────────────
-- 17. dew_water_levels — уровни воды в зумпфах
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.dew_water_levels', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.dew_water_levels (
    id          NVARCHAR(100) NOT NULL PRIMARY KEY,
    sump_id     NVARCHAR(100) NOT NULL DEFAULT '',
    date        DATE          NULL,
    time        NVARCHAR(20)  NOT NULL DEFAULT '',
    elevation   DECIMAL(18,3) NULL,
    measured_by NVARCHAR(400) NOT NULL DEFAULT '',
    notes       NVARCHAR(MAX) NOT NULL DEFAULT '',
    updated_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX idx_dew_water_levels_sump_date ON dbo.dew_water_levels(sump_id, date DESC);
END
GO

-- ────────────────────────────────────────────────────────────
-- 18. dust_orgs — организации (пылеподавление)
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.dust_orgs', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.dust_orgs (
    id         NVARCHAR(100) NOT NULL PRIMARY KEY,
    name       NVARCHAR(400) NOT NULL DEFAULT '',
    notes      NVARCHAR(MAX) NOT NULL DEFAULT '',
    updated_at DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

-- ────────────────────────────────────────────────────────────
-- 19. dust_vehicles — поливомоечные машины
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.dust_vehicles', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.dust_vehicles (
    id                 NVARCHAR(100) NOT NULL PRIMARY KEY,
    org_id             NVARCHAR(100) NOT NULL DEFAULT '',
    name               NVARCHAR(400) NOT NULL DEFAULT '',
    plate_number       NVARCHAR(100) NOT NULL DEFAULT '',
    capacity           DECIMAL(18,3) NULL,
    notes              NVARCHAR(MAX) NOT NULL DEFAULT '',
    default_nozzle_id  NVARCHAR(100) NOT NULL DEFAULT '',
    updated_at         DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX idx_dust_vehicles_org_id ON dbo.dust_vehicles(org_id);
END
GO

-- ────────────────────────────────────────────────────────────
-- 20. dust_nozzles — точки налива/насадки
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.dust_nozzles', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.dust_nozzles (
    id          NVARCHAR(100) NOT NULL PRIMARY KEY,
    name        NVARCHAR(400) NOT NULL DEFAULT '',
    source_type NVARCHAR(100) NOT NULL DEFAULT '',
    source_id   NVARCHAR(100) NULL,
    location    NVARCHAR(400) NOT NULL DEFAULT '',
    notes       NVARCHAR(MAX) NOT NULL DEFAULT '',
    updated_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

-- ────────────────────────────────────────────────────────────
-- 21. dust_logs — журнал выездов на пылеподавление
-- ────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.dust_logs', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.dust_logs (
    id               NVARCHAR(100) NOT NULL PRIMARY KEY,
    date             DATE          NULL,
    org_id           NVARCHAR(100) NOT NULL DEFAULT '',
    vehicle_id       NVARCHAR(100) NOT NULL DEFAULT '',
    nozzle_id        NVARCHAR(100) NOT NULL DEFAULT '',
    trips            INT           NULL,
    total_volume     DECIMAL(18,3) NULL,
    is_manual_volume BIT           NOT NULL DEFAULT 0,
    manual_volume    DECIMAL(18,3) NULL,
    notes            NVARCHAR(MAX) NOT NULL DEFAULT '',
    updated_at       DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX idx_dust_logs_date     ON dbo.dust_logs(date DESC);
  CREATE INDEX idx_dust_logs_org_id   ON dbo.dust_logs(org_id);
  CREATE INDEX idx_dust_logs_nozzle_id ON dbo.dust_logs(nozzle_id);
END
GO

-- ============================================================
-- Готово. Дальше (фото/схемы/3D-модели зумпфов) хранятся не в
-- этой базе, а как файлы в D:\JAM\Prod\GeoAdmin\static\files —
-- таблицы выше хранят только относительные пути/URL к ним.
-- ============================================================
