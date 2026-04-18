-- Allow the same player to appear twice in one match with two different beys
-- (e.g. "Circle Ghost - Max" vs "Saber Samurai" when both are Max's inventory in a tournament).
alter table public.match_participants
  drop constraint if exists match_participants_match_id_player_id_key;

alter table public.match_participants
  add constraint match_participants_match_player_bey unique (match_id, player_id, beyblade_id);
