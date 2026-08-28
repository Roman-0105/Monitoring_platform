-- Migration: VWP-датчики пьезометрических скважин снимаются почасово, а не раз
-- в день, поэтому well_sensor_readings.date (тип date, без времени) больше не
-- достаточен — нужен полноценный timestamp. Существующие строки получат время
-- 00:00:00 (у них и не было времени), это ничего не портит.
-- Run this in Supabase SQL editor.

alter table well_sensor_readings alter column date type timestamp using date::timestamp;
comment on column well_sensor_readings.date is 'Дата и время показания датчика VWP (замеры собираются почасово)';
