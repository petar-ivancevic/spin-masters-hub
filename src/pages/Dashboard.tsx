import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Navbar } from "@/components/Navbar";
import { StatsCard } from "@/components/StatsCard";
import { RecentBattle } from "@/components/RecentBattle";
import { Trophy, Swords, Target, TrendingUp, Award, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { normalizeBeybladeName } from "@/lib/beybladeUtils";
import { Link } from "react-router-dom";

type PlayerRow = {
  id: string;
  display_name: string;
};

type InventoryOption = {
  id: string;
  beyblade_id: string;
  name: string;
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

export default function Dashboard() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [inventoryOptions, setInventoryOptions] = useState<Record<string, InventoryOption[]>>({});
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
        { data: playerData, error: playerError },
        { data: inventoryData, error: inventoryError },
        { data: matchData, error: matchError },
        matchCountResult,
        playerCountResult,
      ] = await Promise.all([
        supabase.from("players").select("id, display_name").order("display_name", { ascending: true }),
        supabase
          .from("player_beyblades")
          .select("id, player_id, beyblade_id, beyblades(name)")
          .order("created_at", { ascending: false }),
        supabase
          .from("matches")
          .select("id, played_at, match_participants(is_winner, players(display_name), beyblades(name))")
          .neq("format", "tournament")
          .order("played_at", { ascending: false })
          .limit(5),
        supabase.from("matches").select("*", { count: "exact", head: true }).neq("format", "tournament"),
        supabase.from("players").select("*", { count: "exact", head: true }),
      ]);

      if (playerError) {
        console.error("Failed to load players:", playerError);
      }

      if (inventoryError) {
        console.error("Failed to load inventory:", inventoryError);
      }

      if (matchError) {
        console.error("Failed to load matches:", matchError);
      }

      const inventoryMap: Record<string, InventoryOption[]> = {};
      (inventoryData ?? []).forEach((entry) => {
        const name = entry.beyblades?.name ?? "Unknown Bey";
        if (!inventoryMap[entry.player_id]) {
          inventoryMap[entry.player_id] = [];
        }
        inventoryMap[entry.player_id].push({
          id: entry.id,
          beyblade_id: entry.beyblade_id,
          name,
        });
      });

      const recent = (matchData ?? [])
        .map((match): RecentBattleItem | null => {
          const participants = match.match_participants ?? [];
          if (participants.length < 2) return null;

          const [first, second] = participants;
          const winnerIndex: 1 | 2 = first.is_winner ? 1 : second.is_winner ? 2 : 1;
          const playedAt = match.played_at ? new Date(match.played_at) : null;
          const date = playedAt
            ? formatDistanceToNow(playedAt, { addSuffix: true })
            : "Recently";

          return {
            player1: first.players?.display_name ?? "Player 1",
            player2: second.players?.display_name ?? "Player 2",
            bey1: first.beyblades?.name ?? "Unknown Bey",
            bey2: second.beyblades?.name ?? "Unknown Bey",
            winner: winnerIndex,
            date,
          };
        })
        .filter((battle): battle is RecentBattleItem => Boolean(battle));

      if (isMounted) {
        setPlayers(playerData ?? []);
        setInventoryOptions(inventoryMap);
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


  const createMatch = async ({
    winnerId,
    scoreAValue,
    scoreBValue,
    eventCounts,
  }: {
    winnerId: string;
    scoreAValue: number;
    scoreBValue: number;
    eventCounts?: { burst: number; knockout: number; extreme_knockout: number; spin_finish: number };
  }) => {
    const { data: matchData, error: matchError } = await supabase
      .from("matches")
      .insert({
        played_at: new Date().toISOString(),
        location: location || null,
        format: mode === "batch" ? "best_of" : "single",
        winner_player_id: winnerId,
      })
      .select("id")
      .single();

    if (matchError || !matchData) {
      throw matchError ?? new Error("Failed to create match");
    }

    const participants = [
      {
        match_id: matchData.id,
        player_id: playerAId,
        beyblade_id: beyAId,
        score: scoreAValue,
        is_winner: winnerId === playerAId,
      },
      {
        match_id: matchData.id,
        player_id: playerBId,
        beyblade_id: beyBId,
        score: scoreBValue,
        is_winner: winnerId === playerBId,
      },
    ];

    const { error: participantError } = await supabase
      .from("match_participants")
      .insert(participants);

    if (participantError) {
      throw participantError;
    }

    if (eventCounts) {
      const eventRows = Object.entries(eventCounts)
        .filter(([, count]) => count > 0)
        .map(([event_type, count]) => ({
          match_id: matchData.id,
          event_type,
          count,
        }));

      if (eventRows.length > 0) {
        const { error: eventError } = await supabase.from("match_events").insert(eventRows);
        if (eventError) {
          throw eventError;
        }
      }
    }
  };

  const handleLogBattle = async () => {
    if (!isSupabaseConfigured) return;
    if (!playerAId || !playerBId || !beyAId || !beyBId) {
      window.alert("Select two bladers and their Beyblades.");
      return;
    }

    const scoreAValue = Number(scoreA);
    const scoreBValue = Number(scoreB);
    const burst = Number(burstCount);
    const knockout = Number(knockoutCount);
    const extremeKnockout = Number(extremeKnockoutCount);
    const spinFinish = Number(spinFinishCount);
    const winnerId = winner === "A" ? playerAId : playerBId;

    try {
      await createMatch({
        winnerId,
        scoreAValue: Number.isFinite(scoreAValue) ? scoreAValue : 0,
        scoreBValue: Number.isFinite(scoreBValue) ? scoreBValue : 0,
        eventCounts: {
          burst: Number.isFinite(burst) ? burst : 0,
          knockout: Number.isFinite(knockout) ? knockout : 0,
          extreme_knockout: Number.isFinite(extremeKnockout) ? extremeKnockout : 0,
          spin_finish: Number.isFinite(spinFinish) ? spinFinish : 0,
        },
      });

      window.alert("Battle logged!");
      setLocation("");
    } catch (error) {
      console.error("Failed to log battle:", error);
      window.alert("Could not log the battle. Check your inputs and try again.");
    }
  };

  const logCsvRow = async (row: {
    matchId: string;
    playerAId: string;
    playerBId: string;
    beyAId: string;
    beyBId: string;
    winner: "A" | "B";
    scoreA: string;
    scoreB: string;
    date: string;
    bursts: string;
    knockouts: string;
    extremeKnockouts: string;
    spinFinishes: string;
  }) => {
    if (!row.matchId || !row.playerAId || !row.playerBId || !row.beyAId || !row.beyBId) {
      return { success: false, error: "Missing required fields" };
    }

    const winnerId = row.winner === "A" ? row.playerAId : row.playerBId;
    const scoreAValue = Number(row.scoreA);
    const scoreBValue = Number(row.scoreB);
    if (!Number.isFinite(scoreAValue) || !Number.isFinite(scoreBValue)) {
      return { success: false, error: "Invalid scores" };
    }

    // Parse date - handle M/D/YYYY format
    let playedAt: Date;
    if (row.date) {
      const dateMatch = row.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (dateMatch) {
        const [, month, day, year] = dateMatch;
        playedAt = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      } else {
        playedAt = new Date(row.date);
      }
    } else {
      playedAt = new Date();
    }
    const { data: matchData, error: matchError } = await supabase
      .from("matches")
      .upsert(
        {
          external_id: row.matchId,
          played_at: Number.isNaN(playedAt.getTime()) ? new Date().toISOString() : playedAt.toISOString(),
          location: location || null,
          format: "best_of",
          winner_player_id: winnerId,
        },
        { onConflict: "external_id", ignoreDuplicates: true }
      )
      .select("id")
      .maybeSingle();

    if (matchError || !matchData) {
      return { success: false, error: matchError?.message ?? "Failed to create match" };
    }

    const participants = [
      {
        match_id: matchData.id,
        player_id: row.playerAId,
        beyblade_id: row.beyAId,
        score: scoreAValue,
        is_winner: winnerId === row.playerAId,
      },
      {
        match_id: matchData.id,
        player_id: row.playerBId,
        beyblade_id: row.beyBId,
        score: scoreBValue,
        is_winner: winnerId === row.playerBId,
      },
    ];

    const { error: participantError } = await supabase.from("match_participants").insert(participants);
    if (participantError) {
      return { success: false, error: participantError.message };
    }

    const bursts = Number(row.bursts);
    const knockouts = Number(row.knockouts);
    const extremeKnockouts = Number(row.extremeKnockouts);
    const spinFinishes = Number(row.spinFinishes);
    const eventRows = [
      { event_type: "burst", count: Number.isFinite(bursts) ? bursts : 0 },
      { event_type: "knockout", count: Number.isFinite(knockouts) ? knockouts : 0 },
      { event_type: "extreme_knockout", count: Number.isFinite(extremeKnockouts) ? extremeKnockouts : 0 },
      { event_type: "spin_finish", count: Number.isFinite(spinFinishes) ? spinFinishes : 0 },
    ]
      .filter((event) => event.count > 0)
      .map((event) => ({
        match_id: matchData.id,
        event_type: event.event_type,
        count: event.count,
      }));

    if (eventRows.length > 0) {
      const { error: eventError } = await supabase.from("match_events").insert(eventRows);
      if (eventError) {
        return { success: false, error: eventError.message };
      }
    }

    return { success: true };
  };

  const parseBatchCsv = (content: string): {
    rows: {
      id: string;
      matchId: string;
      playerAName: string;
      playerBName: string;
      playerAId: string;
      playerBId: string;
      winner: "A" | "B";
      scoreA: string;
      scoreB: string;
      beyAId: string;
      beyBId: string;
      beyAName: string;
      beyBName: string;
      date: string;
      bursts: string;
      knockouts: string;
      extremeKnockouts: string;
      spinFinishes: string;
    }[];
    warnings: string[];
  } => {
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      return { rows: [], warnings: [] };
    }

    const headerCells = lines[0].split(",").map((cell) => cell.trim().toLowerCase());
    const hasHeader =
      headerCells.includes("match_id") ||
      headerCells.includes("player1") ||
      headerCells.includes("player2") ||
      headerCells.includes("player1_bey") ||
      headerCells.includes("player2_bey") ||
      headerCells.includes("winner") ||
      headerCells.includes("scorea") ||
      headerCells.includes("scoreb") ||
      headerCells.includes("date") ||
      headerCells.includes("bursts") ||
      headerCells.includes("knockouts") ||
      headerCells.includes("extreme_knockouts") ||
      headerCells.includes("spin_finishes");

    // Create column index map from header
    const getColumnIndex = (name: string): number => {
      const searchName = name.toLowerCase();
      const normalized = searchName.replace(/_/g, "");
      const idx = headerCells.findIndex((h) => {
        const normalizedHeader = h.replace(/_/g, "");
        return h === searchName || normalizedHeader === normalized;
      });
      if (idx === -1) {
        warnings.push(`Warning: Column "${name}" not found in CSV header. Available columns: ${headerCells.join(", ")}`);
      }
      return idx;
    };

    const matchIdIdx = hasHeader ? getColumnIndex("match_id") : 0;
    const player1Idx = hasHeader ? getColumnIndex("player1") : 1;
    const player1BeyIdx = hasHeader ? getColumnIndex("player1_bey") : 2;
    const player1ScoreIdx = hasHeader ? getColumnIndex("player1_score") : 3;
    const player2Idx = hasHeader ? getColumnIndex("player2") : 4;
    const player2BeyIdx = hasHeader ? getColumnIndex("player2_bey") : 5;
    const player2ScoreIdx = hasHeader ? getColumnIndex("player2_score") : 6;
    const winnerIdx = hasHeader ? getColumnIndex("winner") : 7;
    const dateIdx = hasHeader ? getColumnIndex("date") : 8;
    const burstsIdx = hasHeader ? getColumnIndex("bursts") : 9;
    const knockoutsIdx = hasHeader ? getColumnIndex("knockouts") : 10;
    const extremeKnockoutsIdx = hasHeader ? getColumnIndex("extreme_knockouts") : 11;
    const spinFinishesIdx = hasHeader ? getColumnIndex("spin_finishes") : 12;

    const startIndex = hasHeader ? 1 : 0;
    const rows: {
      id: string;
      matchId: string;
      playerAName: string;
      playerBName: string;
      playerAId: string;
      playerBId: string;
      winner: "A" | "B";
      scoreA: string;
      scoreB: string;
      beyAId: string;
      beyBId: string;
      beyAName: string;
      beyBName: string;
      date: string;
      bursts: string;
      knockouts: string;
      extremeKnockouts: string;
      spinFinishes: string;
    }[] = [];
    const warnings: string[] = [];

    for (let i = startIndex; i < lines.length; i += 1) {
      const cells = lines[i].split(",").map((cell) => cell.trim());
      if (cells.length < 8) {
        warnings.push(`Row ${i + 1}: Skipped (not enough columns)`);
        continue;
      }
      
      // Validate column indices
      if (hasHeader && (matchIdIdx < 0 || player1Idx < 0 || player1BeyIdx < 0 || player2Idx < 0 || player2BeyIdx < 0)) {
        warnings.push(`Row ${i + 1}: Invalid column mapping. Header: ${lines[0]}`);
        continue;
      }
      
      const matchIdRaw = (matchIdIdx >= 0 && matchIdIdx < cells.length) ? cells[matchIdIdx] : "";
      const playerARaw = (player1Idx >= 0 && player1Idx < cells.length) ? cells[player1Idx] : "";
      const beyARaw = (player1BeyIdx >= 0 && player1BeyIdx < cells.length) ? cells[player1BeyIdx] : "";
      const scoreARaw = (player1ScoreIdx >= 0 && player1ScoreIdx < cells.length) ? cells[player1ScoreIdx] : "";
      const playerBRaw = (player2Idx >= 0 && player2Idx < cells.length) ? cells[player2Idx] : "";
      const beyBRaw = (player2BeyIdx >= 0 && player2BeyIdx < cells.length) ? cells[player2BeyIdx] : "";
      const scoreBRaw = (player2ScoreIdx >= 0 && player2ScoreIdx < cells.length) ? cells[player2ScoreIdx] : "";
      const winnerRaw = (winnerIdx >= 0 && winnerIdx < cells.length) ? cells[winnerIdx] : "";
      const dateRaw = (dateIdx >= 0 && dateIdx < cells.length) ? cells[dateIdx] : "";
      const burstsRaw = (burstsIdx >= 0 && burstsIdx < cells.length) ? cells[burstsIdx] : "0";
      const knockoutsRaw = (knockoutsIdx >= 0 && knockoutsIdx < cells.length) ? cells[knockoutsIdx] : "0";
      const extremeKnockoutsRaw = (extremeKnockoutsIdx >= 0 && extremeKnockoutsIdx < cells.length) ? cells[extremeKnockoutsIdx] : "0";
      const spinFinishesRaw = (spinFinishesIdx >= 0 && spinFinishesIdx < cells.length) ? cells[spinFinishesIdx] : "0";
      
      // Debug: log what we're reading
      if (i === startIndex) {
        console.log("CSV Parsing Debug - First row:", {
          matchId: matchIdRaw,
          player1: playerARaw,
          player1Bey: beyARaw,
          player2: playerBRaw,
          player2Bey: beyBRaw,
          allCells: cells,
          indices: { matchIdIdx, player1Idx, player1BeyIdx, player2Idx, player2BeyIdx }
        });
      }
      const playerAId =
        players.find((player) => player.display_name.toLowerCase() === playerARaw.toLowerCase())
          ?.id ?? "";
      const playerBId =
        players.find((player) => player.display_name.toLowerCase() === playerBRaw.toLowerCase())
          ?.id ?? "";
      // Winner can be "A", "B", or a player name - match to player1 or player2
      const winnerUpper = winnerRaw.toUpperCase();
      const winnerMatchesA = winnerUpper === "A" || winnerRaw.toLowerCase() === playerARaw.toLowerCase();
      const winnerMatchesB = winnerUpper === "B" || winnerRaw.toLowerCase() === playerBRaw.toLowerCase();
      const winner = winnerMatchesB ? "B" : winnerMatchesA ? "A" : "A"; // default to A if unclear
      
      if (!winnerMatchesA && !winnerMatchesB && winnerRaw) {
        warnings.push(`Row ${i + 1}: Winner "${winnerRaw}" doesn't match player1 or player2, defaulting to player1`);
      }
      // Normalize names using the utility function
      
      const beyAIdFromName =
        (inventoryOptions[playerAId] ?? []).find(
          (bey) => {
            const beyName = normalizeBeybladeName(bey.name);
            const csvName = normalizeBeybladeName(beyARaw);
            return beyName === csvName;
          }
        )?.beyblade_id ?? "";
      const beyBIdFromName =
        (inventoryOptions[playerBId] ?? []).find(
          (bey) => {
            const beyName = normalizeBeybladeName(bey.name);
            const csvName = normalizeBeybladeName(beyBRaw);
            return beyName === csvName;
          }
        )?.beyblade_id ?? "";

      if (!playerAId) {
        warnings.push(`Row ${i + 1}: Player "${playerARaw}" not found`);
      }
      if (!playerBId) {
        warnings.push(`Row ${i + 1}: Player "${playerBRaw}" not found`);
      }
      if (!beyAIdFromName && playerAId) {
        const available = (inventoryOptions[playerAId] ?? []).map(b => b.name).join(", ");
        const csvBey = beyARaw;
        const availableList = (inventoryOptions[playerAId] ?? []).map(b => `"${b.name}"`).join(", ");
        warnings.push(`Row ${i + 1}: Bey "${csvBey}" not found for ${playerARaw}. Looking for: "${csvBey}" (length: ${csvBey.length}). Available: ${availableList || "none"}`);
      }
      if (!beyBIdFromName && playerBId) {
        const available = (inventoryOptions[playerBId] ?? []).map(b => b.name).join(", ");
        const csvBey = beyBRaw;
        const availableList = (inventoryOptions[playerBId] ?? []).map(b => `"${b.name}"`).join(", ");
        warnings.push(`Row ${i + 1}: Bey "${csvBey}" not found for ${playerBRaw}. Looking for: "${csvBey}" (length: ${csvBey.length}). Available: ${availableList || "none"}`);
      }

      rows.push({
        id: `row-${i - startIndex + 1}`,
        matchId: matchIdRaw,
        playerAName: playerARaw,
        playerBName: playerBRaw,
        playerAId,
        playerBId,
        winner,
        scoreA: scoreARaw || "1",
        scoreB: scoreBRaw || "0",
        beyAId: beyAIdFromName,
        beyBId: beyBIdFromName,
        beyAName: beyARaw,
        beyBName: beyBRaw,
        date: dateRaw,
        bursts: burstsRaw || "0",
        knockouts: knockoutsRaw || "0",
        extremeKnockouts: extremeKnockoutsRaw || "0",
        spinFinishes: spinFinishesRaw || "0",
      });
    }

    return { rows, warnings };
  };

  const handleBatchImport = async () => {
    if (!isSupabaseConfigured) {
      window.alert("Supabase is not configured.");
      return;
    }

    setCsvSummary("Loading and processing CSV...");
    try {
      const response = await fetch(`/batch-import.csv?ts=${Date.now()}&v=${Math.random()}`);
      if (!response.ok) {
        setCsvSummary("Error: Could not load batch-import.csv from the server.");
        return;
      }

      const text = await response.text();
      console.log("Raw CSV content (first 500 chars):", text.substring(0, 500));
      console.log("CSV line count:", text.split(/\r?\n/).length);
      const { rows: parsed, warnings } = parseBatchCsv(text);
      if (parsed.length === 0) {
        setCsvSummary("No valid rows found in the import file.");
        return;
      }

      let successCount = 0;
      let skipCount = 0;
      let errorCount = 0;
      const errors: string[] = [];
      const existingMatchIds = new Set<string>();

      for (const row of parsed) {
        if (!row.matchId) {
          errorCount++;
          errors.push(`Row ${row.id}: Missing match_id`);
          continue;
        }
        if (existingMatchIds.has(row.matchId)) {
          skipCount++;
          continue;
        }
        
        // Skip rows with missing required data
        if (!row.playerAId || !row.playerBId) {
          errorCount++;
          errors.push(`Row ${row.id} (${row.matchId}): Missing players - "${row.playerAName}" or "${row.playerBName}" not found in database`);
          continue;
        }
        if (!row.beyAId || !row.beyBId) {
          errorCount++;
          errors.push(`Row ${row.id} (${row.matchId}): Missing Beyblades - "${row.beyAName}" or "${row.beyBName}" not found in player inventories`);
          continue;
        }
        
        existingMatchIds.add(row.matchId);

        const result = await logCsvRow(row);
        if (result.success) {
          successCount++;
        } else {
          errorCount++;
          errors.push(`Row ${row.id} (${row.matchId}): ${result.error}`);
        }
      }

      const summary = [
        `CSV Import Complete`,
        `Total rows: ${parsed.length}`,
        `✅ Logged: ${successCount}`,
        `⏭️  Skipped (duplicates): ${skipCount}`,
        `❌ Errors: ${errorCount}`,
        ...(warnings.length > 0 ? [`\nWarnings:\n${warnings.slice(0, 10).join("\n")}${warnings.length > 10 ? `\n... and ${warnings.length - 10} more` : ""}`] : []),
        ...(errors.length > 0 ? [`\nErrors:\n${errors.slice(0, 10).join("\n")}${errors.length > 10 ? `\n... and ${errors.length - 10} more` : ""}`] : []),
      ].join("\n");

      setCsvSummary(summary);
    } catch (error) {
      console.error("Failed to import CSV:", error);
      setCsvSummary(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="pt-24 pb-12 px-4">
        <div className="container mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-2">
              Battle <span className="text-gradient-primary">Dashboard</span>
            </h1>
            <p className="text-muted-foreground">
              Select bladers, log battles, and track your inventory
            </p>
          </div>

          {/* Stats Grid */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
            <StatsCard
              title="Total Battles"
              value={totals.battles}
              subtitle="All time"
              icon={Swords}
            />
            <StatsCard
              title="Bladers"
              value={totals.players}
              subtitle="Registered"
              icon={Target}
            />
            <StatsCard
              title="Status"
              value={isLoading ? "Loading..." : "Ready"}
              subtitle="Supabase"
              icon={TrendingUp}
            />
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-8">
              {/* Battle Logger - Removed, use CSV Editor instead */}
              <section>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-display text-2xl font-bold text-foreground">
                    Log <span className="text-gradient-accent">Battles</span>
                  </h2>
                  <Button variant="default" asChild>
                    <Link to="/csv-editor">
                      <Upload className="w-4 h-4 mr-2" />
                      Open CSV Editor
                    </Link>
                  </Button>
                </div>
                <div className="rounded-xl bg-gradient-card border border-border p-6">
                  <p className="text-muted-foreground text-center py-8">
                    Use the CSV Editor to log battles. Click "Open CSV Editor" above.
                  </p>
                </div>
              </section>

              {/* Recent Battles */}
              <section>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-display text-2xl font-bold text-foreground">
                    Recent <span className="text-gradient-primary">Battles</span>
                  </h2>
                  <Button variant="ghost" size="sm">
                    View All →
                  </Button>
                </div>
                <div className="space-y-4">
                  {recentBattles.map((battle, i) => (
                    <RecentBattle key={i} {...battle} />
                  ))}
                  {!isLoading && recentBattles.length === 0 && (
                    <p className="text-sm text-muted-foreground">No battles logged yet.</p>
                  )}
                </div>
              </section>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Quick Actions */}
              <div className="rounded-xl bg-gradient-card border border-border p-6">
                <h3 className="font-display text-lg font-bold text-foreground mb-4">Quick Actions</h3>
                <div className="space-y-3">
                  <Button variant="default" className="w-full justify-start" asChild>
                    <Link to="/csv-editor">
                      <Swords className="w-4 h-4 mr-2" />
                      Log New Battle
                    </Link>
                  </Button>
                  <Button variant="ghost" className="w-full justify-start">
                    <Award className="w-4 h-4 mr-2" />
                    View Achievements
                  </Button>
                </div>
              </div>

              {/* Performance Chart Placeholder */}
              <div className="rounded-xl bg-gradient-card border border-border p-6">
                <h3 className="font-display text-lg font-bold text-foreground mb-4">Win Rate Trend</h3>
                <div className="h-40 flex items-center justify-center border border-dashed border-border rounded-lg">
                  <p className="text-sm text-muted-foreground">Chart coming soon</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
