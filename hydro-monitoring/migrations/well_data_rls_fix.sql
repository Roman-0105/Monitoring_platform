-- Fix: Supabase SQL editor auto-enables Row Level Security on newly created tables,
-- but no policy was defined for wp_well_levels / well_sensor_readings — so reads worked
-- (empty result, not blocked) while writes were rejected with "new row violates
-- row-level security policy". This app has no per-row ownership anywhere else (every
-- other table is fully open to any authenticated session), so we match that here.
-- Run this in Supabase SQL editor.

alter table wp_well_levels enable row level security;
drop policy if exists "allow_all" on wp_well_levels;
create policy "allow_all" on wp_well_levels for all to public using (true) with check (true);

alter table well_sensor_readings enable row level security;
drop policy if exists "allow_all" on well_sensor_readings;
create policy "allow_all" on well_sensor_readings for all to public using (true) with check (true);
