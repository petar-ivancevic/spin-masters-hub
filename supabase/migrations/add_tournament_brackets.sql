-- Tournament bracket tables (single / double elimination)

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Tournament',
  elimination_type text not null check (elimination_type in ('single', 'double')),
  status text not null default 'draft' check (status in ('draft', 'in_progress', 'completed')),
  started_at timestamptz,
  finished_at timestamptz,
  owner_user_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete restrict,
  seed_order integer not null,
  losses integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tournament_id, player_id),
  unique (tournament_id, seed_order)
);

create table if not exists public.tournament_round_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  bracket_side text not null check (bracket_side in ('winners', 'losers', 'grand')),
  round_index integer not null,
  match_index integer not null,
  player_a_id uuid references public.players(id) on delete set null,
  player_b_id uuid references public.players(id) on delete set null,
  winner_player_id uuid references public.players(id) on delete set null,
  match_id uuid references public.matches(id) on delete set null,
  feed_a_from uuid references public.tournament_round_matches(id) on delete set null,
  feed_b_from uuid references public.tournament_round_matches(id) on delete set null,
  loser_feed_a_from uuid references public.tournament_round_matches(id) on delete set null,
  loser_feed_b_from uuid references public.tournament_round_matches(id) on delete set null,
  player_b_from_loser_of uuid references public.tournament_round_matches(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tournament_id, bracket_side, round_index, match_index)
);

create index if not exists idx_tournaments_status on public.tournaments(status);
create index if not exists idx_tournament_entries_tournament on public.tournament_entries(tournament_id);
create index if not exists idx_tournament_round_matches_tournament on public.tournament_round_matches(tournament_id);
create index if not exists idx_tournament_round_matches_feeds on public.tournament_round_matches(feed_a_from, feed_b_from);

alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_round_matches enable row level security;

create policy "Public read access to tournaments"
  on public.tournaments for select to public using (true);
create policy "Public write access to tournaments"
  on public.tournaments for insert to public with check (true);
create policy "Public update access to tournaments"
  on public.tournaments for update to public using (true) with check (true);
create policy "Public delete access to tournaments"
  on public.tournaments for delete to public using (true);

create policy "Public read access to tournament entries"
  on public.tournament_entries for select to public using (true);
create policy "Public write access to tournament entries"
  on public.tournament_entries for insert to public with check (true);
create policy "Public update access to tournament entries"
  on public.tournament_entries for update to public using (true) with check (true);
create policy "Public delete access to tournament entries"
  on public.tournament_entries for delete to public using (true);

create policy "Public read access to tournament round matches"
  on public.tournament_round_matches for select to public using (true);
create policy "Public write access to tournament round matches"
  on public.tournament_round_matches for insert to public with check (true);
create policy "Public update access to tournament round matches"
  on public.tournament_round_matches for update to public using (true) with check (true);
create policy "Public delete access to tournament round matches"
  on public.tournament_round_matches for delete to public using (true);
