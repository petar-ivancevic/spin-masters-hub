import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Navbar } from "@/components/Navbar";
import { BeybladeCard } from "@/components/BeybladeCard";
import { RecentBattle } from "@/components/RecentBattle";
import { Swords, Users, Zap, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

type BeyType = "Attack" | "Defense" | "Stamina" | "Balance";

type BeybladeRow = {
  id: string;
  name: string;
  type: string;
  attack: number | null;
  defense: number | null;
  stamina: number | null;
};

type TopBeyblade = BeybladeRow & {
  type: BeyType;
  wins: number;
  losses: number;
};

type MatchParticipantRow = {
  is_winner: boolean;
  players: { display_name: string } | null;
  beyblades: { name: string } | null;
};

type MatchRow = {
  id: string;
  played_at: string | null;
  match_participants: MatchParticipantRow[] | null;
};

type RecentBattleItem = {
  player1: string;
  player2: string;
  bey1: string;
  bey2: string;
  winner: 1 | 2;
  date: string;
};

const allowedTypes: BeyType[] = ["Attack", "Defense", "Stamina", "Balance"];

export default function Index() {
  const [topBeyblades, setTopBeyblades] = useState<TopBeyblade[]>([]);
  const [recentBattles, setRecentBattles] = useState<RecentBattleItem[]>([]);
  const [totals, setTotals] = useState({ battles: 0, players: 0, beyblades: 0 });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    const loadDashboard = async () => {
      setIsLoading(true);

      const [
        { data: beyData, error: beyError },
        { data: participantData, error: participantError },
        { data: playerBeyData, error: playerBeyError },
      ] = await Promise.all([
        supabase
          .from("beyblades")
          .select("id, name, type, attack, defense, stamina"),
        supabase
          .from("match_participants")
          .select("beyblade_id, is_winner"),
        supabase
          .from("player_beyblades")
          .select("beyblade_id, attack, defense, stamina"),
      ]);

      if (beyError) {
        console.error("Failed to load beyblades:", beyError);
      }

      if (participantError) {
        console.error("Failed to load match participants:", participantError);
      }

      if (playerBeyError) {
        console.error("Failed to load player beyblade stats:", playerBeyError);
      }

      const statsByBey = new Map<string, { wins: number; losses: number }>();
      (participantData ?? []).forEach((participant) => {
        if (!participant.beyblade_id) return;
        const current = statsByBey.get(participant.beyblade_id) ?? { wins: 0, losses: 0 };
        if (participant.is_winner) {
          current.wins += 1;
        } else {
          current.losses += 1;
        }
        statsByBey.set(participant.beyblade_id, current);
      });

      // Create a map of best available stats per beyblade (prefer player-specific stats over catalog stats)
      // If multiple players have set stats, we'll use the first non-null one we find
      const statsByBeyId = new Map<string, { attack: number | null; defense: number | null; stamina: number | null }>();
      (playerBeyData ?? []).forEach((entry) => {
        if (!entry.beyblade_id) return;
        const existing = statsByBeyId.get(entry.beyblade_id);
        // Use player-specific stats if they exist and we don't already have stats for this bey
        if (!existing && (entry.attack !== null || entry.defense !== null || entry.stamina !== null)) {
          statsByBeyId.set(entry.beyblade_id, {
            attack: entry.attack,
            defense: entry.defense,
            stamina: entry.stamina,
          });
        }
      });

      const normalized = (beyData ?? []).map((bey) => {
        const normalizedType = allowedTypes.includes(bey.type as BeyType)
          ? (bey.type as BeyType)
          : "Balance";
        const stats = statsByBey.get(bey.id) ?? { wins: 0, losses: 0 };
        // Use player-specific stats if available, otherwise use catalog stats
        const playerStats = statsByBeyId.get(bey.id);
        const attack = playerStats?.attack ?? bey.attack ?? null;
        const defense = playerStats?.defense ?? bey.defense ?? null;
        const stamina = playerStats?.stamina ?? bey.stamina ?? null;
        return {
          ...bey,
          type: normalizedType,
          wins: stats.wins,
          losses: stats.losses,
          attack,
          defense,
          stamina,
        };
      });

      const ranked = normalized
        .map((bey) => {
          const total = bey.wins + bey.losses;
          const winRate = total > 0 ? bey.wins / total : 0;
          return { bey, total, winRate };
        })
        .sort((a, b) => b.winRate - a.winRate || b.total - a.total)
        .slice(0, 3)
        .map((entry) => entry.bey);

      const { data: matchData, error: matchError } = await supabase
        .from("matches")
        .select("id, played_at, match_participants(is_winner, players(display_name), beyblades(name))")
        .neq("format", "tournament")
        .order("played_at", { ascending: false })
        .limit(5);

      if (matchError) {
        console.error("Failed to load matches:", matchError);
      }

      const recent = (matchData ?? [])
        .map((match): RecentBattleItem | null => {
          const participants = match.match_participants ?? [];
          if (participants.length < 2) return null;

          const [first, second] = participants;
          const winner: 1 | 2 = first.is_winner ? 1 : second.is_winner ? 2 : 1;
          const playedAt = match.played_at ? new Date(match.played_at) : null;
          const date = playedAt
            ? formatDistanceToNow(playedAt, { addSuffix: true })
            : "Recently";

          return {
            player1: first.players?.display_name ?? "Player 1",
            player2: second.players?.display_name ?? "Player 2",
            bey1: first.beyblades?.name ?? "Unknown Bey",
            bey2: second.beyblades?.name ?? "Unknown Bey",
            winner,
            date,
          };
        })
        .filter((battle): battle is RecentBattleItem => Boolean(battle));

      const [matchCountResult, playerCountResult] = await Promise.all([
        supabase.from("matches").select("*", { count: "exact", head: true }).neq("format", "tournament"),
        supabase.from("players").select("*", { count: "exact", head: true }),
      ]);

      if (isMounted) {
        setTopBeyblades(ranked);
        setRecentBattles(recent);
        setTotals({
          battles: matchCountResult.count ?? 0,
          players: playerCountResult.count ?? 0,
          beyblades: 0,
        });
        setIsLoading(false);
      }
    };

    loadDashboard().catch((error) => {
      console.error("Failed to load dashboard:", error);
      if (isMounted) {
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero - Simple & Personal */}
      <section className="pt-28 pb-16 px-4">
        <div className="container mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-full px-4 py-2 mb-6">
            <Zap className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-primary">Track your battles</span>
          </div>
          
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-4">
            Your <span className="text-gradient-primary">Beyblade</span> Battle Log
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-8">
            Keep track of battles, stats, and collections for your local league.
            Perfect for family matches and friendly competitions.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button variant="hero" size="lg" asChild>
              <Link to="/csv-editor">
                <Plus className="w-5 h-5 mr-2" />
                Log a Battle
              </Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link to="/inventory">View Collection</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Quick Stats */}
      <section className="py-12 px-4">
        <div className="container mx-auto">
          <div className="grid sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
            <div className="text-center p-6 rounded-xl bg-gradient-card border border-border">
              <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-3">
                <Swords className="w-6 h-6 text-primary" />
              </div>
              <p className="text-3xl font-display font-bold text-foreground">{totals.battles}</p>
              <p className="text-sm text-muted-foreground">Total Battles</p>
            </div>
            <div className="text-center p-6 rounded-xl bg-gradient-card border border-border">
              <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-3">
                <Users className="w-6 h-6 text-accent" />
              </div>
              <p className="text-3xl font-display font-bold text-foreground">{totals.players}</p>
              <p className="text-sm text-muted-foreground">Bladers</p>
            </div>
          </div>
        </div>
      </section>

      {/* Top Beyblades & Recent Battles */}
      <section className="py-12 px-4">
        <div className="container mx-auto">
          <div className="grid lg:grid-cols-2 gap-12">
            {/* Top Beyblades */}
            <div>
              <h2 className="font-display text-2xl font-bold text-foreground mb-6">
                Top <span className="text-gradient-accent">Performers</span>
              </h2>
              <div className="space-y-4">
                {topBeyblades.map((bey, i) => (
                  <BeybladeCard key={i} {...bey} />
                ))}
                {!isLoading && topBeyblades.length === 0 && (
                  <p className="text-sm text-muted-foreground">No beyblades yet.</p>
                )}
              </div>
              <Button variant="ghost" className="w-full mt-4" asChild>
                <Link to="/inventory">View All Beyblades →</Link>
              </Button>
            </div>

            {/* Recent Battles */}
            <div>
              <h2 className="font-display text-2xl font-bold text-foreground mb-6">
                Recent <span className="text-gradient-primary">Battles</span>
              </h2>
              <div className="space-y-4">
                {recentBattles.map((battle, i) => (
                  <RecentBattle key={i} {...battle} />
                ))}
                {!isLoading && recentBattles.length === 0 && (
                  <p className="text-sm text-muted-foreground">No battles logged yet.</p>
                )}
              </div>
              <Button variant="ghost" className="w-full mt-4" asChild>
                <Link to="/dashboard">View All Battles →</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-border mt-8">
        <div className="container mx-auto text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center">
              <Swords className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-display font-bold text-lg text-gradient-primary">BeyTracker</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Track. Battle. Have Fun!
          </p>
        </div>
      </footer>
    </div>
  );
}
