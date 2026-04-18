create extension if not exists "pgcrypto";

create table if not exists public.beyblades (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type text not null check (type in ('Attack', 'Defense', 'Stamina', 'Balance')),
  product_code text,
  source_wave text,
  raw_type text,
  attack smallint check (attack between 0 and 100),
  defense smallint check (defense between 0 and 100),
  stamina smallint check (stamina between 0 and 100),
  notes text,
  owner_user_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  display_name text not null unique,
  nickname text,
  owner_user_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  played_at timestamptz not null default now(),
  location text,
  notes text,
  format text not null default 'single' check (format in ('single', 'best_of', 'tournament')),
  winner_player_id uuid references public.players(id) on delete set null,
  owner_user_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.match_participants (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete restrict,
  beyblade_id uuid not null references public.beyblades(id) on delete restrict,
  score integer not null default 0,
  is_winner boolean not null default false,
  created_at timestamptz not null default now(),
  unique (match_id, player_id, beyblade_id)
);

create table if not exists public.match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  event_type text not null check (event_type in ('burst', 'knockout', 'extreme_knockout', 'spin_finish')),
  count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.player_beyblades (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  beyblade_id uuid not null references public.beyblades(id) on delete restrict,
  attack smallint check (attack between 0 and 100),
  defense smallint check (defense between 0 and 100),
  stamina smallint check (stamina between 0 and 100),
  notes text,
  created_at timestamptz not null default now(),
  unique (player_id, beyblade_id)
);

create index if not exists idx_beyblades_type on public.beyblades(type);
create index if not exists idx_matches_played_at on public.matches(played_at desc);
create index if not exists idx_match_participants_player on public.match_participants(player_id);
create index if not exists idx_match_participants_bey on public.match_participants(beyblade_id);
create index if not exists idx_match_events_match on public.match_events(match_id);
create index if not exists idx_player_beyblades_player on public.player_beyblades(player_id);
create index if not exists idx_player_beyblades_bey on public.player_beyblades(beyblade_id);

alter table public.beyblades enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.match_participants enable row level security;
alter table public.match_events enable row level security;
alter table public.player_beyblades enable row level security;

create policy "Public read access to beyblades"
  on public.beyblades for select to public using (true);
create policy "Public write access to beyblades"
  on public.beyblades for insert to public with check (true);
create policy "Public update access to beyblades"
  on public.beyblades for update to public using (true) with check (true);
create policy "Public delete access to beyblades"
  on public.beyblades for delete to public using (true);

create policy "Public read access to players"
  on public.players for select to public using (true);
create policy "Public write access to players"
  on public.players for insert to public with check (true);
create policy "Public update access to players"
  on public.players for update to public using (true) with check (true);
create policy "Public delete access to players"
  on public.players for delete to public using (true);

create policy "Public read access to matches"
  on public.matches for select to public using (true);
create policy "Public write access to matches"
  on public.matches for insert to public with check (true);
create policy "Public update access to matches"
  on public.matches for update to public using (true) with check (true);
create policy "Public delete access to matches"
  on public.matches for delete to public using (true);

create policy "Public read access to match participants"
  on public.match_participants for select to public using (true);
create policy "Public write access to match participants"
  on public.match_participants for insert to public with check (true);
create policy "Public update access to match participants"
  on public.match_participants for update to public using (true) with check (true);
create policy "Public delete access to match participants"
  on public.match_participants for delete to public using (true);

create policy "Public read access to match events"
  on public.match_events for select to public using (true);
create policy "Public write access to match events"
  on public.match_events for insert to public with check (true);
create policy "Public update access to match events"
  on public.match_events for update to public using (true) with check (true);
create policy "Public delete access to match events"
  on public.match_events for delete to public using (true);

create policy "Public read access to player beyblades"
  on public.player_beyblades for select to public using (true);
create policy "Public write access to player beyblades"
  on public.player_beyblades for insert to public with check (true);
create policy "Public update access to player beyblades"
  on public.player_beyblades for update to public using (true) with check (true);
create policy "Public delete access to player beyblades"
  on public.player_beyblades for delete to public using (true);

-- Tournaments (single / double elimination brackets)
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
  player_id uuid references public.players(id) on delete restrict,
  beyblade_id uuid references public.beyblades(id) on delete restrict,
  owner_player_id uuid references public.players(id) on delete set null,
  seed_order integer not null,
  losses integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tournament_id, seed_order)
);

create unique index if not exists tournament_entries_tournament_beyblade_unique
  on public.tournament_entries (tournament_id, beyblade_id)
  where beyblade_id is not null;

create table if not exists public.tournament_round_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  bracket_side text not null check (bracket_side in ('winners', 'losers', 'grand')),
  round_index integer not null,
  match_index integer not null,
  player_a_id uuid references public.players(id) on delete set null,
  player_b_id uuid references public.players(id) on delete set null,
  beyblade_a_id uuid references public.beyblades(id) on delete set null,
  beyblade_b_id uuid references public.beyblades(id) on delete set null,
  winner_player_id uuid references public.players(id) on delete set null,
  winner_beyblade_id uuid references public.beyblades(id) on delete set null,
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
