-- For Supabase SQL Editor (not the .mjs file).
-- Clear all tournament bracket data and tournament-format match logs.
-- Safe for league / casual data: only touches `tournaments` (+ cascades) and `matches.format = 'tournament'`.
--
-- Run in Supabase Dashboard → SQL Editor (as postgres), or:
--   supabase db execute --file scripts/clear-tournament-data.sql
--
begin;

delete from public.tournaments;

delete from public.matches
where format = 'tournament';

commit;
