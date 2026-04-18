-- Bey-centric tournaments: entrants and bracket slots are beys; owners used only for match logging.

alter table public.tournament_entries drop constraint if exists tournament_entries_tournament_id_player_id_key;

alter table public.tournament_entries
  add column if not exists beyblade_id uuid references public.beyblades(id) on delete restrict;

alter table public.tournament_entries
  add column if not exists owner_player_id uuid references public.players(id) on delete set null;

alter table public.tournament_entries
  alter column player_id drop not null;

alter table public.tournament_round_matches
  add column if not exists beyblade_a_id uuid references public.beyblades(id) on delete set null;

alter table public.tournament_round_matches
  add column if not exists beyblade_b_id uuid references public.beyblades(id) on delete set null;

alter table public.tournament_round_matches
  add column if not exists winner_beyblade_id uuid references public.beyblades(id) on delete set null;

-- Prefer unique per bey per tournament when beyblade_id is set (ignore legacy player-only rows).
create unique index if not exists tournament_entries_tournament_beyblade_unique
  on public.tournament_entries (tournament_id, beyblade_id)
  where beyblade_id is not null;
