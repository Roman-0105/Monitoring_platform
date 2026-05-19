-- ============================================================
-- Monitoring Platform — полная схема Supabase
-- Включает: точки, историю, фото, канавы, историю канав,
--           сотрудников, горизонты, схемы
-- Запустить в SQL Editor → Run
-- ============================================================

-- ── workers ──────────────────────────────────────────────────
create table if not exists workers (
  id          text primary key,
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── points ───────────────────────────────────────────────────
create table if not exists points (
  id               text primary key,
  version          integer not null default 1,
  device_id        text,
  sync_status      text not null default 'synced',
  synced_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  monitoring_date  date,
  point_number     text not null default '',
  worker           text not null default '',
  lat              double precision,
  lon              double precision,
  x_local          double precision,
  y_local          double precision,
  intensity        text not null default '',
  flow_rate        double precision,
  water_color      text not null default '',
  wall             text not null default '',
  domain           text not null default '',
  status           text not null default 'Новая',
  measure_method   text not null default '',
  horizon          text not null default '',
  comment          text not null default '',
  photo_urls       text[] not null default '{}'
);

-- ── history (История замеров) ─────────────────────────────────
create table if not exists history (
  id               bigserial primary key,
  point_number     text not null,
  monitoring_date  date,
  flow_rate        double precision,
  flow_rate_m3h    double precision,
  status           text not null default '',
  intensity        text not null default '',
  measure_method   text not null default '',
  worker           text not null default '',
  recorded_at      timestamptz not null default now()
);

-- ── photos (Фото — полная история) ───────────────────────────
create table if not exists photos (
  id               bigserial primary key,
  point_number     text not null,
  monitoring_date  date,
  photo_url        text not null,
  flow_rate        double precision,
  uploaded_at      timestamptz not null default now()
);

-- ── ditches (Канавы) ─────────────────────────────────────────
create table if not exists ditches (
  id               text primary key,
  point_number     text not null default '',
  ditch_name       text not null default '',
  monitoring_date  date,
  worker           text not null default '',
  lat              double precision,
  lon              double precision,
  x_local          double precision,
  y_local          double precision,
  status           text not null default 'Активная',
  width            double precision,
  vel_method       text not null default 'single',
  velocity         double precision,
  float_l          double precision,
  float_t          double precision,
  float_k          double precision,
  dist_mode        text not null default 'u',
  n_points         integer,
  depths           jsonb not null default '[]',
  dists            jsonb not null default '[]',
  area             double precision,
  flow_m3h         double precision,
  comment          text not null default '',
  photo_urls       text[] not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── ditch_history (История канав) ────────────────────────────
create table if not exists ditch_history (
  id               bigserial primary key,
  ditch_name       text not null,
  point_number     text not null default '',
  monitoring_date  date,
  worker           text not null default '',
  width            double precision,
  area             double precision,
  flow_m3h         double precision,
  vel_method       text not null default '',
  recorded_at      timestamptz not null default now()
);

-- ── schemes ──────────────────────────────────────────────────
create table if not exists schemes (
  id            uuid primary key default gen_random_uuid(),
  week_key      text not null unique,
  storage_path  text not null,
  uploaded_at   timestamptz,
  uploaded_by   text
);

-- ── horizons ─────────────────────────────────────────────────
create table if not exists horizons (
  id    serial primary key,
  name  text not null unique
);

-- ── Row Level Security ────────────────────────────────────────
alter table workers      enable row level security;
alter table points       enable row level security;
alter table history      enable row level security;
alter table photos       enable row level security;
alter table ditches      enable row level security;
alter table ditch_history enable row level security;
alter table schemes      enable row level security;
alter table horizons     enable row level security;

create policy "anon full access" on workers       for all to anon using (true) with check (true);
create policy "anon full access" on points        for all to anon using (true) with check (true);
create policy "anon full access" on history       for all to anon using (true) with check (true);
create policy "anon full access" on photos        for all to anon using (true) with check (true);
create policy "anon full access" on ditches       for all to anon using (true) with check (true);
create policy "anon full access" on ditch_history for all to anon using (true) with check (true);
create policy "anon full access" on schemes       for all to anon using (true) with check (true);
create policy "anon full access" on horizons      for all to anon using (true) with check (true);

-- ── Индексы ──────────────────────────────────────────────────
create index if not exists points_monitoring_date_idx  on points(monitoring_date);
create index if not exists points_status_idx           on points(status);
create index if not exists points_worker_idx           on points(worker);
create index if not exists points_point_number_idx     on points(point_number);
create index if not exists history_point_number_idx    on history(point_number);
create index if not exists history_date_idx            on history(monitoring_date);
create index if not exists photos_point_number_idx     on photos(point_number);
create index if not exists ditches_point_number_idx    on ditches(point_number);
create index if not exists ditch_history_name_idx      on ditch_history(ditch_name);
create index if not exists schemes_week_key_idx        on schemes(week_key);
