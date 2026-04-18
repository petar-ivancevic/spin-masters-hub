import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { supabase } from "@/lib/supabaseClient";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import { Button } from "@/components/ui/button";
import { BarChart3, TrendingUp, Users, Swords, Trophy, Medal } from "lucide-react";
import { aggregateTournamentBeyCareer, type TournamentMeta, type TournamentRoundMatchRow } from "@/lib/tournamentReport";

type PlayerRow = {
  id: string;
  display_name: string;
};

type BeybladeRow = {
  id: string;
  name: string;
  type: string;
};

type MatchStats = {
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  bursts: number;
  knockouts: number;
  extremeKnockouts: number;
  spinFinishes: number;
};

type EventStats = {
  burst: number;
  knockout: number;
  extreme_knockout: number;
  spin_finish: number;
};

const COLORS = ["#f97316", "#3b82f6", "#10b981", "#8b5cf6", "#ef4444", "#f59e0b"];

/** Scope for charts and totals: everything, non-tournament only, or tournament bracket only. */
type FormatFilter = "all" | "league" | "tournament";

export default function Reports() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [beyblades, setBeyblades] = useState<BeybladeRow[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<string>("all");
  const [selectedBey, setSelectedBey] = useState<string>("all");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isSupabaseConfigured, setIsSupabaseConfigured] = useState(false);

  const [playerStats, setPlayerStats] = useState<Record<string, MatchStats>>({});
  const [beyStats, setBeyStats] = useState<Record<string, MatchStats>>({});
  const [typeStats, setTypeStats] = useState<Record<string, MatchStats>>({});
  const [eventStats, setEventStats] = useState<EventStats>({ burst: 0, knockout: 0, extreme_knockout: 0, spin_finish: 0 });
  const [overallStats, setOverallStats] = useState<MatchStats>({
    total: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    bursts: 0,
    knockouts: 0,
    extremeKnockouts: 0,
    spinFinishes: 0,
  });
  /** Count of `matches` rows with format tournament (bracket logs from /tournament). */
  const [tournamentGamesTotal, setTournamentGamesTotal] = useState(0);
  /** Bracket-derived career stats when analyzing tournament games (bey-only). */
  const [tournamentBeyCareer, setTournamentBeyCareer] = useState<
    Record<string, { titles: number; bestRank: number; bestLabel: string; tournamentsEntered: number }>
  >({});

  useEffect(() => {
    const checkSupabase = async () => {
      const url = import.meta.env.VITE_SUPABASE_URL;
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (url && key) {
        setIsSupabaseConfigured(true);
        await loadData();
      } else {
        setIsSupabaseConfigured(false);
        setIsLoading(false);
      }
    };
    checkSupabase();
  }, []);

  useEffect(() => {
    if (isSupabaseConfigured) {
      loadStats();
    }
  }, [selectedPlayer, selectedBey, selectedType, formatFilter, isSupabaseConfigured]);

  const loadData = async () => {
    try {
      const [playersRes, beybladesRes] = await Promise.all([
        supabase.from("players").select("id, display_name").order("display_name"),
        supabase.from("beyblades").select("id, name, type").order("name"),
      ]);

      if (playersRes.data) setPlayers(playersRes.data);
      if (beybladesRes.data) setBeyblades(beybladesRes.data);
      setIsLoading(false);
    } catch (error) {
      console.error("Failed to load data:", error);
      setIsLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      // Fetch all matches (format separates tournament bey-vs-bey from league/casual battles)
      const { data: matches, error: matchesError } = await supabase
        .from("matches")
        .select("id, winner_player_id, format");

      if (matchesError) throw matchesError;

      if (!matches || matches.length === 0) {
        setPlayerStats({});
        setBeyStats({});
        setTypeStats({});
        setEventStats({ burst: 0, knockout: 0, extreme_knockout: 0, spin_finish: 0 });
        setOverallStats({ total: 0, wins: 0, losses: 0, winRate: 0, bursts: 0, knockouts: 0, extremeKnockouts: 0, spinFinishes: 0 });
        setTournamentGamesTotal(0);
        setTournamentBeyCareer({});
        return;
      }

      const formatByMatchId: Record<string, string> = {};
      for (const m of matches) {
        formatByMatchId[m.id] = (m as { format?: string }).format ?? "single";
      }
      const tournamentGamesCount = matches.filter((m) => formatByMatchId[m.id] === "tournament").length;

      const matchesInScope = matches.filter((m) => {
        const f = formatByMatchId[m.id];
        if (formatFilter === "all") return true;
        if (formatFilter === "league") return f !== "tournament";
        return f === "tournament";
      });
      const matchIds = matchesInScope.map((m) => m.id);

      if (matchIds.length === 0) {
        setPlayerStats({});
        setBeyStats({});
        setTypeStats({});
        setEventStats({ burst: 0, knockout: 0, extreme_knockout: 0, spin_finish: 0 });
        setOverallStats({ total: 0, wins: 0, losses: 0, winRate: 0, bursts: 0, knockouts: 0, extremeKnockouts: 0, spinFinishes: 0 });
        setTournamentGamesTotal(tournamentGamesCount);
        if (formatFilter === "tournament") {
          const { data: tlist } = await supabase.from("tournaments").select("id, elimination_type");
          const tids = (tlist as TournamentMeta[] | null)?.map((t) => t.id) ?? [];
          if (tids.length > 0) {
            const { data: trm } = await supabase
              .from("tournament_round_matches")
              .select(
                "tournament_id, bracket_side, round_index, match_index, beyblade_a_id, beyblade_b_id, winner_beyblade_id"
              )
              .in("tournament_id", tids);
            const { data: ent } = await supabase.from("tournament_entries").select("tournament_id, beyblade_id").in("tournament_id", tids);
            setTournamentBeyCareer(
              aggregateTournamentBeyCareer((tlist as TournamentMeta[]) ?? [], (trm as TournamentRoundMatchRow[]) ?? [], ent ?? [])
            );
          } else setTournamentBeyCareer({});
        } else setTournamentBeyCareer({});
        return;
      }

      // Fetch participants (only matches in the selected format scope)
      let participantQuery = supabase
        .from("match_participants")
        .select("match_id, player_id, beyblade_id, is_winner, score")
        .in("match_id", matchIds);

      if (selectedPlayer !== "all" && formatFilter !== "tournament") {
        participantQuery = participantQuery.eq("player_id", selectedPlayer);
      }
      if (selectedBey !== "all") {
        participantQuery = participantQuery.eq("beyblade_id", selectedBey);
      }

      const { data: participants, error: participantsError } = await participantQuery;
      if (participantsError) {
        console.error("Error fetching participants:", participantsError);
        throw participantsError;
      }
      
      if (!participants || participants.length === 0) {
        console.log("No participants found for matches:", matchIds);
        setPlayerStats({});
        setBeyStats({});
        setTypeStats({});
        setEventStats({ burst: 0, knockout: 0, extreme_knockout: 0, spin_finish: 0 });
        setOverallStats({ total: 0, wins: 0, losses: 0, winRate: 0, bursts: 0, knockouts: 0, extremeKnockouts: 0, spinFinishes: 0 });
        setTournamentGamesTotal(tournamentGamesCount);
        if (formatFilter === "tournament") {
          const { data: tlist } = await supabase.from("tournaments").select("id, elimination_type");
          const tids = (tlist as TournamentMeta[] | null)?.map((t) => t.id) ?? [];
          if (tids.length > 0) {
            const { data: trm } = await supabase
              .from("tournament_round_matches")
              .select(
                "tournament_id, bracket_side, round_index, match_index, beyblade_a_id, beyblade_b_id, winner_beyblade_id"
              )
              .in("tournament_id", tids);
            const { data: ent } = await supabase.from("tournament_entries").select("tournament_id, beyblade_id").in("tournament_id", tids);
            setTournamentBeyCareer(
              aggregateTournamentBeyCareer((tlist as TournamentMeta[]) ?? [], (trm as TournamentRoundMatchRow[]) ?? [], ent ?? [])
            );
          } else setTournamentBeyCareer({});
        } else setTournamentBeyCareer({});
        return;
      }

      // Fetch beyblades to get types
      const beyIds = [...new Set((participants || []).map((p: any) => p.beyblade_id))];
      const { data: beybladesData, error: beybladesError } = await supabase
        .from("beyblades")
        .select("id, type")
        .in("id", beyIds);

      if (beybladesError) throw beybladesError;

      // Create a map of beyblade_id -> type
      const beyTypeMap: Record<string, string> = {};
      if (beybladesData) {
        for (const bey of beybladesData) {
          beyTypeMap[bey.id] = bey.type || "Unknown";
        }
      }

      // Filter participants by type if needed
      let filteredParticipants = participants || [];
      if (selectedType !== "all" && participants) {
        filteredParticipants = participants.filter((p: any) => beyTypeMap[p.beyblade_id] === selectedType);
      }

      // Get unique match IDs from filtered participants
      const filteredMatchIds = new Set(filteredParticipants.map((p: any) => p.match_id));

      // Fetch events for filtered matches
      const { data: events, error: eventsError } = await supabase
        .from("match_events")
        .select("match_id, event_type, count")
        .in("match_id", Array.from(filteredMatchIds));

      if (eventsError) throw eventsError;

      // Calculate stats
      const playerStatsMap: Record<string, MatchStats> = {};
      const beyStatsMap: Record<string, MatchStats> = {};
      const typeStatsMap: Record<string, MatchStats> = {};
      const eventStatsMap: EventStats = { burst: 0, knockout: 0, extreme_knockout: 0, spin_finish: 0 };
      let overall: MatchStats = {
        total: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        bursts: 0,
        knockouts: 0,
        extremeKnockouts: 0,
        spinFinishes: 0,
      };

      // Process events (tournament 1-pt logs typically have no match_events rows)
      if (events) {
        for (const event of events) {
          if (filteredMatchIds.has(event.match_id)) {
            if (event.event_type === "burst") eventStatsMap.burst += event.count || 0;
            if (event.event_type === "knockout") eventStatsMap.knockout += event.count || 0;
            if (event.event_type === "extreme_knockout") eventStatsMap.extreme_knockout += event.count || 0;
            if (event.event_type === "spin_finish") eventStatsMap.spin_finish += event.count || 0;
          }
        }
      }

      // Process participants (match set already scoped by format filter)
      if (filteredParticipants && filteredParticipants.length > 0) {
        for (const participant of filteredParticipants) {
          const playerId = participant.player_id;
          const beyId = participant.beyblade_id;
          const beyType = beyTypeMap[beyId] || "Unknown";
          const isWinner = participant.is_winner;

          if (formatFilter !== "tournament") {
            if (!playerStatsMap[playerId]) {
              playerStatsMap[playerId] = {
                total: 0,
                wins: 0,
                losses: 0,
                winRate: 0,
                bursts: 0,
                knockouts: 0,
                extremeKnockouts: 0,
                spinFinishes: 0,
              };
            }
            playerStatsMap[playerId].total++;
            if (isWinner) playerStatsMap[playerId].wins++;
            else playerStatsMap[playerId].losses++;
          }

          if (!beyStatsMap[beyId]) {
            beyStatsMap[beyId] = {
              total: 0,
              wins: 0,
              losses: 0,
              winRate: 0,
              bursts: 0,
              knockouts: 0,
              extremeKnockouts: 0,
              spinFinishes: 0,
            };
          }
          beyStatsMap[beyId].total++;
          if (isWinner) beyStatsMap[beyId].wins++;
          else beyStatsMap[beyId].losses++;

          // Type stats
          if (!typeStatsMap[beyType]) {
            typeStatsMap[beyType] = {
              total: 0,
              wins: 0,
              losses: 0,
              winRate: 0,
              bursts: 0,
              knockouts: 0,
              extremeKnockouts: 0,
              spinFinishes: 0,
            };
          }
          typeStatsMap[beyType].total++;
          if (isWinner) typeStatsMap[beyType].wins++;
          else typeStatsMap[beyType].losses++;
        }
      }

      overall.total = new Set(filteredParticipants.map((p: { match_id: string }) => p.match_id)).size;

      // Calculate win rates (bladers skipped for tournament-only scope)
      Object.keys(playerStatsMap).forEach((id) => {
        const stats = playerStatsMap[id];
        stats.winRate = stats.total > 0 ? (stats.wins / stats.total) * 100 : 0;
      });
      Object.keys(beyStatsMap).forEach((id) => {
        const stats = beyStatsMap[id];
        stats.winRate = stats.total > 0 ? (stats.wins / stats.total) * 100 : 0;
      });
      Object.keys(typeStatsMap).forEach((type) => {
        const stats = typeStatsMap[type];
        stats.winRate = stats.total > 0 ? (stats.wins / stats.total) * 100 : 0;
      });

      // Calculate overall stats (tournament view: bey-only totals — owners may not match who used the bey)
      if (formatFilter === "tournament") {
        overall.wins = Object.values(beyStatsMap).reduce((sum, s) => sum + s.wins, 0);
        overall.losses = Object.values(beyStatsMap).reduce((sum, s) => sum + s.losses, 0);
        const bl = overall.wins + overall.losses;
        overall.winRate = bl > 0 ? (overall.wins / bl) * 100 : 0;
      } else {
        overall.wins = Object.values(playerStatsMap).reduce((sum, s) => sum + s.wins, 0);
        overall.losses = Object.values(playerStatsMap).reduce((sum, s) => sum + s.losses, 0);
        const totalParticipantBattles = overall.wins + overall.losses;
        overall.winRate = totalParticipantBattles > 0 ? (overall.wins / totalParticipantBattles) * 100 : 0;
      }
      overall.bursts = eventStatsMap.burst;
      overall.knockouts = eventStatsMap.knockout;
      overall.extremeKnockouts = eventStatsMap.extreme_knockout;
      overall.spinFinishes = eventStatsMap.spin_finish;

      setPlayerStats(playerStatsMap);
      setBeyStats(beyStatsMap);
      setTypeStats(typeStatsMap);
      setEventStats(eventStatsMap);
      setOverallStats(overall);
      setTournamentGamesTotal(tournamentGamesCount);

      if (formatFilter === "tournament") {
        const { data: tlist } = await supabase.from("tournaments").select("id, elimination_type");
        const tids = (tlist as TournamentMeta[] | null)?.map((t) => t.id) ?? [];
        if (tids.length > 0) {
          const { data: trm } = await supabase
            .from("tournament_round_matches")
            .select(
              "tournament_id, bracket_side, round_index, match_index, beyblade_a_id, beyblade_b_id, winner_beyblade_id"
            )
            .in("tournament_id", tids);
          const { data: ent } = await supabase.from("tournament_entries").select("tournament_id, beyblade_id").in("tournament_id", tids);
          setTournamentBeyCareer(
            aggregateTournamentBeyCareer((tlist as TournamentMeta[]) ?? [], (trm as TournamentRoundMatchRow[]) ?? [], ent ?? [])
          );
        } else setTournamentBeyCareer({});
      } else {
        setTournamentBeyCareer({});
      }
    } catch (error) {
      console.error("Failed to load stats:", error);
      setTournamentGamesTotal(0);
      setTournamentBeyCareer({});
    }
  };

  // Prepare chart data
  const playerChartData = Object.entries(playerStats)
    .map(([id, stats]) => {
      const player = players.find((p) => p.id === id);
      return {
        name: player?.display_name || "Unknown",
        wins: stats.wins,
        losses: stats.losses,
        winRate: Number(stats.winRate.toFixed(1)),
      };
    })
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 10);

  const beyChartData = Object.entries(beyStats)
    .map(([id, stats]) => {
      const bey = beyblades.find((b) => b.id === id);
      return {
        name: bey?.name || "Unknown",
        wins: stats.wins,
        losses: stats.losses,
        winRate: Number(stats.winRate.toFixed(1)),
      };
    })
    .sort((a, b) => (formatFilter === "tournament" ? b.wins - a.wins : b.winRate - a.winRate))
    .slice(0, 10);

  const tournamentBeyTableRows =
    formatFilter === "tournament"
      ? Object.entries(beyStats)
          .map(([id, st]) => {
            const bey = beyblades.find((b) => b.id === id);
            const c = tournamentBeyCareer[id];
            return {
              id,
              name: bey?.name ?? "Unknown",
              type: bey?.type ?? "",
              wins: st.wins,
              losses: st.losses,
              winRate: st.winRate,
              titles: c?.titles ?? 0,
              best: c?.bestLabel ?? "—",
              entered: c?.tournamentsEntered ?? 0,
            };
          })
          .sort((a, b) => b.wins - a.wins)
      : [];

  const typeChartData = Object.entries(typeStats).map(([type, stats]) => ({
    name: type,
    value: stats.total,
    wins: stats.wins,
    losses: stats.losses,
    winRate: Number(stats.winRate.toFixed(1)),
  }));

  const eventChartData = [
    { name: "Bursts", value: eventStats.burst, color: COLORS[0] },
    { name: "Knockouts", value: eventStats.knockout, color: COLORS[1] },
    { name: "Extreme Knockouts", value: eventStats.extreme_knockout, color: COLORS[2] },
    { name: "Spin Finishes", value: eventStats.spin_finish, color: COLORS[3] },
  ].filter((item) => item.value > 0);

  const chartConfig = {
    wins: { label: "Wins", color: "#10b981" },
    losses: { label: "Losses", color: "#ef4444" },
    winRate: { label: "Win Rate %", color: "#3b82f6" },
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="pt-24 pb-12 px-4">
        <div className="container mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-2">
              Battle <span className="text-gradient-primary">Reports</span>
            </h1>
            <p className="text-muted-foreground">Analyze performance by blader, Beyblade, type, and events</p>
            <p className="text-xs text-muted-foreground mt-2 max-w-2xl">
              {formatFilter === "all" && (
                <>
                  Use <strong className="text-foreground">Battle source</strong> below to show everything together,{" "}
                  <strong className="text-foreground">league only</strong> (hide tournament), or{" "}
                  <strong className="text-foreground">tournament only</strong>. With &quot;All&quot;, every chart uses the
                  same battle set.
                </>
              )}
              {formatFilter === "league" && (
                <>
                  Showing <strong className="text-foreground">league and other logged</strong> battles only; tournament
                  bracket games are excluded from every chart and total.
                </>
              )}
              {formatFilter === "tournament" && (
                <>
                  <strong className="text-foreground">Bey-only reporting:</strong> charts and tables ignore bladers
                  (inventory owners may not match who used the bey). Bracket columns add{" "}
                  <strong className="text-foreground">titles</strong> and <strong className="text-foreground">best finish</strong>{" "}
                  from saved brackets (single elim winners path).
                </>
              )}
            </p>
          </div>

          {!isSupabaseConfigured ? (
            <div className="rounded-xl bg-gradient-card border border-border p-8 text-center">
              <p className="text-muted-foreground">Supabase is not configured. Please set your environment variables.</p>
            </div>
          ) : (
            <>
              {/* Filters */}
              <div className="rounded-xl bg-gradient-card border border-border p-6 mb-8">
                <h2 className="font-display text-lg font-bold text-foreground mb-4">Filters</h2>
                <div className={`grid sm:grid-cols-2 gap-4 ${formatFilter === "tournament" ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Battle source</label>
                    <select
                      value={formatFilter}
                      onChange={(e) => setFormatFilter(e.target.value as FormatFilter)}
                      className="h-10 w-full rounded-lg bg-secondary border border-border px-3 text-sm text-foreground"
                    >
                      <option value="all">All (league + tournament)</option>
                      <option value="league">League (excl. tournament)</option>
                      <option value="tournament">Tournament only</option>
                    </select>
                  </div>
                  {formatFilter !== "tournament" && (
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Blader</label>
                      <select
                        value={selectedPlayer}
                        onChange={(e) => setSelectedPlayer(e.target.value)}
                        className="h-10 w-full rounded-lg bg-secondary border border-border px-3 text-sm text-foreground"
                      >
                        <option value="all">All Bladers</option>
                        {players.map((player) => (
                          <option key={player.id} value={player.id}>
                            {player.display_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Beyblade</label>
                    <select
                      value={selectedBey}
                      onChange={(e) => setSelectedBey(e.target.value)}
                      className="h-10 w-full rounded-lg bg-secondary border border-border px-3 text-sm text-foreground"
                    >
                      <option value="all">All Beyblades</option>
                      {beyblades.map((bey) => (
                        <option key={bey.id} value={bey.id}>
                          {bey.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Type</label>
                    <select
                      value={selectedType}
                      onChange={(e) => setSelectedType(e.target.value)}
                      className="h-10 w-full rounded-lg bg-secondary border border-border px-3 text-sm text-foreground"
                    >
                      <option value="all">All Types</option>
                      <option value="Attack">Attack</option>
                      <option value="Defense">Defense</option>
                      <option value="Stamina">Stamina</option>
                      <option value="Balance">Balance</option>
                    </select>
                  </div>
                </div>
                <div className="mt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedPlayer("all");
                      setSelectedBey("all");
                      setSelectedType("all");
                      setFormatFilter("all");
                    }}
                  >
                    Clear Filters
                  </Button>
                </div>
              </div>

              {formatFilter !== "tournament" && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 mb-8 flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="font-display text-sm font-semibold text-foreground flex items-center gap-2">
                      <Trophy className="w-4 h-4 text-primary shrink-0" />
                      Tournament bracket games
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                      Logged from the{" "}
                      <Link to="/tournament" className="text-primary underline underline-offset-2 hover:text-primary/90">
                        Tournament
                      </Link>{" "}
                      page (1 pt wins). This count is database-wide. Use{" "}
                      <strong className="text-foreground">Battle source → Tournament only</strong> for bey-only
                      reporting.
                    </p>
                  </div>
                  <div className="text-3xl font-bold font-display text-primary tabular-nums shrink-0">
                    {tournamentGamesTotal}
                  </div>
                </div>
              )}

              {/* Overall Stats */}
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="rounded-xl bg-gradient-card border border-border p-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Total Battles</span>
                    <Swords className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="text-2xl font-bold text-foreground">{overallStats.total}</div>
                </div>
                <div className="rounded-xl bg-gradient-card border border-border p-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">
                      {formatFilter === "tournament" ? "Bey win %" : "Win Rate"}
                    </span>
                    <TrendingUp className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="text-2xl font-bold text-foreground">{overallStats.winRate.toFixed(1)}%</div>
                </div>
                <div className="rounded-xl bg-gradient-card border border-border p-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">
                      {formatFilter === "tournament" ? "Bey wins (sides)" : "Total Wins"}
                    </span>
                    <Users className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="text-2xl font-bold text-foreground">{overallStats.wins}</div>
                </div>
                <div className="rounded-xl bg-gradient-card border border-border p-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">
                      {formatFilter === "tournament" ? "Bey losses (sides)" : "Total Losses"}
                    </span>
                    <BarChart3 className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="text-2xl font-bold text-foreground">{overallStats.losses}</div>
                </div>
              </div>

              {/* Charts Grid */}
              <div className={`grid gap-6 mb-8 ${formatFilter === "tournament" ? "lg:grid-cols-1" : "lg:grid-cols-2"}`}>
                {formatFilter !== "tournament" && (
                  <div className="rounded-xl bg-gradient-card border border-border p-6">
                    <h3 className="font-display text-lg font-bold text-foreground mb-1">Top Blader Win Rates</h3>
                    <p className="text-xs text-muted-foreground mb-4">
                      {formatFilter === "all" &&
                        "Includes league, import/CSV, dashboard, and tournament bracket games."}
                      {formatFilter === "league" && "League and other logged battles only; tournament excluded."}
                    </p>
                    {playerChartData.length > 0 ? (
                      <ChartContainer config={chartConfig} className="h-[300px]">
                        <BarChart data={playerChartData}>
                          <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                          <YAxis />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Bar dataKey="winRate" fill="var(--color-winRate)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ChartContainer>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-8">No data available</p>
                    )}
                  </div>
                )}

                <div className="rounded-xl bg-gradient-card border border-border p-6">
                  <h3 className="font-display text-lg font-bold text-foreground mb-1">
                    {formatFilter === "tournament" ? "Tournament Beyblade leaders" : "Top Beyblade Win Rates"}
                  </h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    {formatFilter === "all" && "Includes league, import/CSV, dashboard, and tournament bracket games."}
                    {formatFilter === "league" && "League and other logged battles only; tournament excluded."}
                    {formatFilter === "tournament" &&
                      "Sorted by wins. Bars are wins vs losses per bey (1-pt bracket games). Tooltip includes win %."}
                    {formatFilter !== "tournament" && "Win % is the default sort for league / combined views."}
                  </p>
                  {beyChartData.length > 0 ? (
                    <ChartContainer config={chartConfig} className="h-[300px]">
                      <BarChart data={beyChartData}>
                        <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                        <YAxis />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        {formatFilter === "tournament" ? (
                          <>
                            <ChartLegend content={<ChartLegendContent />} />
                            <Bar dataKey="wins" name="Wins" fill="var(--color-wins)" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="losses" name="Losses" fill="var(--color-losses)" radius={[4, 4, 0, 0]} />
                          </>
                        ) : (
                          <Bar dataKey="winRate" fill="var(--color-winRate)" radius={[4, 4, 0, 0]} />
                        )}
                      </BarChart>
                    </ChartContainer>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">No data available</p>
                  )}
                </div>
              </div>

              {formatFilter === "tournament" && tournamentBeyTableRows.length > 0 && (
                <div className="rounded-xl bg-gradient-card border border-border p-6 mb-8 overflow-x-auto">
                  <h3 className="font-display text-lg font-bold text-foreground mb-1 flex items-center gap-2">
                    <Medal className="w-5 h-5 text-primary shrink-0" />
                    Tournament records (by bey)
                  </h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    Bracket finishes use single-elim <strong className="text-foreground">winners</strong> path only.
                    Double-elim titles are not inferred yet.
                  </p>
                  <table className="w-full text-sm text-left border-collapse min-w-[640px]">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="py-2 pr-3">Beyblade</th>
                        <th className="py-2 pr-3">Type</th>
                        <th className="py-2 pr-3 text-right">W</th>
                        <th className="py-2 pr-3 text-right">L</th>
                        <th className="py-2 pr-3 text-right">Win %</th>
                        <th className="py-2 pr-3 text-right">Titles</th>
                        <th className="py-2 pr-3 text-right">Entered</th>
                        <th className="py-2 text-right">Best finish</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tournamentBeyTableRows.map((row) => (
                        <tr key={row.id} className="border-b border-border/60 last:border-0">
                          <td className="py-2 pr-3 font-medium text-foreground">{row.name}</td>
                          <td className="py-2 pr-3 text-muted-foreground">{row.type || "—"}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{row.wins}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-rose-600 dark:text-rose-400">{row.losses}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                            {row.wins + row.losses > 0 ? row.winRate.toFixed(1) : "—"}%
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">{row.titles}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{row.entered}</td>
                          <td className="py-2 text-right font-medium text-primary">{row.best}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className={`grid gap-6 mb-8 ${formatFilter === "tournament" ? "lg:grid-cols-1" : "lg:grid-cols-2"}`}>
                {/* Event Distribution */}
                {formatFilter !== "tournament" && (
                <div className="rounded-xl bg-gradient-card border border-border p-6">
                  <h3 className="font-display text-lg font-bold text-foreground mb-4">Event Distribution</h3>
                  {eventChartData.length > 0 ? (
                    <ChartContainer config={chartConfig} className="h-[300px]">
                      <PieChart>
                        <Pie
                          data={eventChartData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {eventChartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <ChartLegend content={<ChartLegendContent />} />
                      </PieChart>
                    </ChartContainer>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">No event data available</p>
                  )}
                </div>
                )}

                {/* Type Distribution */}
                <div className="rounded-xl bg-gradient-card border border-border p-6">
                  <h3 className="font-display text-lg font-bold text-foreground mb-4">Battles by Type</h3>
                  {typeChartData.length > 0 ? (
                    <ChartContainer config={chartConfig} className="h-[300px]">
                      <PieChart>
                        <Pie
                          data={typeChartData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {typeChartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <ChartLegend content={<ChartLegendContent />} />
                      </PieChart>
                    </ChartContainer>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">No type data available</p>
                  )}
                </div>
              </div>

              {formatFilter !== "tournament" && (
                <div className="rounded-xl bg-gradient-card border border-border p-6 mb-8">
                  <h3 className="font-display text-lg font-bold text-foreground mb-1">Blader Performance (Wins vs Losses)</h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    {formatFilter === "all" && "Same battle source as the blader win rate chart above."}
                    {formatFilter === "league" && "League scope only (tournament excluded)."}
                  </p>
                  {playerChartData.length > 0 ? (
                    <ChartContainer config={chartConfig} className="h-[300px]">
                      <BarChart data={playerChartData}>
                        <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                        <YAxis />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <ChartLegend content={<ChartLegendContent />} />
                        <Bar dataKey="wins" fill="var(--color-wins)" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="losses" fill="var(--color-losses)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ChartContainer>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">No data available</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
