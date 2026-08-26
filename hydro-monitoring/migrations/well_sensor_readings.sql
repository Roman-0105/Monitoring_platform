-- Migration: readings from VWP sensors installed in piezometric wells (wells.sensors, jsonb)
-- Each reading is "water level above the sensor" (typical VWP pressure-transducer output).
-- Absolute water elevation is computed on read as:
--   sensor elevation = wells.zLocal - sensor.depth
--   water elevation  = sensor elevation + level_above_sensor
-- Run this in Supabase SQL editor.

create table if not exists well_sensor_readings (
  id                 text primary key,
  well_id            text not null references wells(id) on delete cascade,
  sensor_id          text not null,
  date               date not null,
  level_above_sensor numeric(10,3) not null,
  notes              text,
  created_at         timestamptz not null default now()
);

create index if not exists well_sensor_readings_well_id_idx   on well_sensor_readings(well_id);
create index if not exists well_sensor_readings_sensor_id_idx on well_sensor_readings(sensor_id);

comment on table well_sensor_readings is 'Показания датчиков VWP пьезометрических скважин: уровень воды над датчиком';
comment on column well_sensor_readings.level_above_sensor is 'Уровень воды над датчиком, м';
