-- ============================================================
-- Monitoring Platform — Supabase schema
-- Run this in: Supabase → SQL Editor → Run
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

-- ── schemes ──────────────────────────────────────────────────
create table if not exists schemes (
  id            uuid primary key default gen_random_uuid(),
  week_key      text not null unique,   -- "2026-W13"
  storage_path  text not null,          -- "2026-W13.jpg"
  uploaded_at   timestamptz,
  uploaded_by   text
);

-- ── horizons ─────────────────────────────────────────────────
create table if not exists horizons (
  id    serial primary key,
  name  text not null unique
);

-- ── Row Level Security (RLS) ──────────────────────────────────
-- Включаем RLS, но разрешаем всё через anon-ключ (сайт без авторизации).
-- В будущем можно ужесточить, добавив auth.

alter table workers  enable row level security;
alter table points   enable row level security;
alter table schemes  enable row level security;
alter table horizons enable row level security;

-- Политики: anon может читать и писать всё
create policy "anon full access" on workers  for all to anon using (true) with check (true);
create policy "anon full access" on points   for all to anon using (true) with check (true);
create policy "anon full access" on schemes  for all to anon using (true) with check (true);
create policy "anon full access" on horizons for all to anon using (true) with check (true);

-- ── Индексы ──────────────────────────────────────────────────
create index if not exists points_monitoring_date_idx on points(monitoring_date);
create index if not exists points_status_idx          on points(status);
create index if not exists points_worker_idx          on points(worker);
create index if not exists schemes_week_key_idx       on schemes(week_key);
