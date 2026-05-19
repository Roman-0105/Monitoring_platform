-- ============================================================
-- Monitoring Platform — упрощённая схема (4 таблицы)
-- Запустить в Supabase → SQL Editor → Run
--
-- История точек   = SELECT * FROM points WHERE point_number = X
-- История канав   = SELECT * FROM ditches WHERE ditch_name = X
-- Фото            = хранятся как массив URL в points.photos
-- ============================================================

-- ── points ───────────────────────────────────────────────────
-- Каждая строка = один замер в одной точке в одну дату
create table if not exists points (
  id               text primary key,
  point_number     text        not null default '',
  monitoring_date  date,
  worker           text        not null default '',
  lat              double precision,
  lon              double precision,
  x_local          double precision,
  y_local          double precision,
  status           text        not null default 'Новая',
  intensity        text        not null default '',
  flow_rate        double precision,
  water_color      text        not null default '',
  wall             text        not null default '',
  domain           text        not null default '',
  measure_method   text        not null default '',
  horizon          text        not null default '',
  comment          text        not null default '',
  photos           text[]      not null default '{}',
  created_at       timestamptz not null default now()
);

-- ── ditches ──────────────────────────────────────────────────
-- Каждая строка = один замер одной канавы в одну дату
create table if not exists ditches (
  id               text primary key,
  point_number     text        not null default '',
  ditch_name       text        not null default '',
  monitoring_date  date,
  worker           text        not null default '',
  lat              double precision,
  lon              double precision,
  x_local          double precision,
  y_local          double precision,
  status           text        not null default 'Активная',
  width            double precision,
  vel_method       text        not null default 'single',
  velocity         double precision,
  float_l          double precision,
  float_t          double precision,
  float_k          double precision,
  dist_mode        text        not null default 'u',
  n_points         integer,
  depths           jsonb       not null default '[]',
  dists            jsonb       not null default '[]',
  area             double precision,
  flow_m3h         double precision,
  comment          text        not null default '',
  photos           text[]      not null default '{}',
  created_at       timestamptz not null default now()
);

-- ── workers ──────────────────────────────────────────────────
create table if not exists workers (
  id         text primary key,
  name       text        not null,
  active     boolean     not null default true,
  created_at timestamptz not null default now()
);

-- ── schemes ──────────────────────────────────────────────────
create table if not exists schemes (
  week_key     text primary key,
  storage_path text        not null,
  uploaded_at  timestamptz not null default now(),
  uploaded_by  text        not null default ''
);

-- ── Row Level Security ────────────────────────────────────────
alter table points   enable row level security;
alter table ditches  enable row level security;
alter table workers  enable row level security;
alter table schemes  enable row level security;

create policy "anon full access" on points   for all to anon using (true) with check (true);
create policy "anon full access" on ditches  for all to anon using (true) with check (true);
create policy "anon full access" on workers  for all to anon using (true) with check (true);
create policy "anon full access" on schemes  for all to anon using (true) with check (true);

-- ── Индексы ──────────────────────────────────────────────────
create index if not exists points_point_number_idx    on points(point_number);
create index if not exists points_monitoring_date_idx on points(monitoring_date desc);
create index if not exists points_status_idx          on points(status);
create index if not exists ditches_point_number_idx   on ditches(point_number);
create index if not exists ditches_ditch_name_idx     on ditches(ditch_name);
create index if not exists ditches_date_idx           on ditches(monitoring_date desc);
