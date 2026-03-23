import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Download, Upload, Save } from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { normalizeBeybladeName } from "@/lib/beybladeUtils";

type PlayerRow = {
  id: string;
  display_name: string;
};

type BeybladeRow = {
  id: string;
  name: string;
  normalized_name: string | null;
};

type CsvRow = {
  id: string;
  matchId: string;
  player1: string;
  player1Bey: string;
  player1Score: string;
  player2: string;
  player2Bey: string;
  player2Score: string;
  winner: string;
  date: string;
  bursts: string;
  knockouts: string;
  extremeKnockouts: string;
  spinFinishes: string;
};

export default function CsvEditor() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [beyblades, setBeyblades] = useState<BeybladeRow[]>([]);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [player1Filter, setPlayer1Filter] = useState<Record<string, string>>({});
  const [player2Filter, setPlayer2Filter] = useState<Record<string, string>>({});
  const [inventoryOptions, setInventoryOptions] = useState<Record<string, { id: string; beyblade_id: string; name: string }[]>>({});
  const [importSummary, setImportSummary] = useState<string>("");
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    const loadData = async () => {
      setIsLoading(true);
      const [playersRes, beybladesRes, inventoryRes] = await Promise.all([
        supabase.from("players").select("id, display_name").order("display_name"),
        supabase.from("beyblades").select("id, name, normalized_name").order("name"),
        supabase
          .from("player_beyblades")
          .select("id, player_id, beyblade_id, beyblades(name)")
          .order("created_at", { ascending: false }),
      ]);

      if (playersRes.data) setPlayers(playersRes.data);
      if (beybladesRes.data) setBeyblades(beybladesRes.data);
      
      // Build inventory map
      const inventoryMap: Record<string, { id: string; beyblade_id: string; name: string }[]> = {};
      (inventoryRes.data ?? []).forEach((entry) => {
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
      setInventoryOptions(inventoryMap);

      // Get existing match IDs from database to avoid loading already-imported matches
      const { data: existingMatches } = await supabase
        .from("matches")
        .select("external_id")
        .not("external_id", "is", null);
      
      const existingMatchIds = new Set((existingMatches ?? []).map(m => m.external_id));

      // Load existing CSV, but filter out matches that already exist in DB
      try {
        const response = await fetch(`/batch-import.csv?ts=${Date.now()}`);
        if (response.ok) {
          const text = await response.text();
          const lines = text.split(/\r?\n/).filter((line) => line.trim());
          if (lines.length > 1) {
            const headerCells = lines[0].split(",").map((c) => c.trim().toLowerCase());
            const dataRows: CsvRow[] = [];
            for (let i = 1; i < lines.length; i++) {
              const cells = lines[i].split(",").map((c) => c.trim());
              if (cells.length >= 8) {
                const getCol = (name: string) => {
                  const idx = headerCells.findIndex((h) => h === name.toLowerCase() || h === name.toLowerCase().replace("_", ""));
                  return idx >= 0 && idx < cells.length ? cells[idx] : "";
                };
                const matchId = getCol("match_id");
                // Skip if match already exists in database
                if (matchId && existingMatchIds.has(matchId)) {
                  continue;
                }
                const player1Score = Number(getCol("player1_score")) || 0;
                const player2Score = Number(getCol("player2_score")) || 0;
                const player1 = getCol("player1");
                const player2 = getCol("player2");
                // Auto-determine winner from score
                const winner = player1Score > player2Score ? player1 : player2Score > player1Score ? player2 : player1;
                dataRows.push({
                  id: `row-${i}`,
                  matchId,
                  player1,
                  player1Bey: getCol("player1_bey"),
                  player1Score: String(player1Score),
                  player2,
                  player2Bey: getCol("player2_bey"),
                  player2Score: String(player2Score),
                  winner,
                  date: getCol("date"),
                  bursts: getCol("bursts") || "0",
                  knockouts: getCol("knockouts") || "0",
                  extremeKnockouts: getCol("extreme_knockouts") || "0",
                  spinFinishes: getCol("spin_finishes") || "0",
                });
              }
            }
            // If no rows from CSV (all already imported), start with a new row
            if (dataRows.length === 0) {
              const nextMatchId = await getNextMatchId();
              const stevanPlayer = playersRes.data?.find(p => p.display_name === "Stevan");
              const maxPlayer = playersRes.data?.find(p => p.display_name === "Max");
              dataRows.push({
                id: `row-${Date.now()}`,
                matchId: nextMatchId,
                player1: stevanPlayer?.display_name || "",
                player1Bey: "",
                player1Score: "0",
                player2: maxPlayer?.display_name || "",
                player2Bey: "",
                player2Score: "0",
                winner: "",
                date: new Date().toLocaleDateString("en-US"),
                bursts: "0",
                knockouts: "0",
                extremeKnockouts: "0",
                spinFinishes: "0",
              });
            }
            setRows(dataRows);
          } else {
            // CSV is empty, start with a new row
            const nextMatchId = await getNextMatchId();
            const stevanPlayer = playersRes.data?.find(p => p.display_name === "Stevan");
            const maxPlayer = playersRes.data?.find(p => p.display_name === "Max");
            setRows([{
              id: `row-${Date.now()}`,
              matchId: nextMatchId,
              player1: stevanPlayer?.display_name || "",
              player1Bey: "",
              player1Score: "0",
              player2: maxPlayer?.display_name || "",
              player2Bey: "",
              player2Score: "0",
              winner: "",
              date: new Date().toLocaleDateString("en-US"),
              bursts: "0",
              knockouts: "0",
              extremeKnockouts: "0",
              spinFinishes: "0",
            }]);
          }
        } else {
          // CSV file not found, start with a new row
          const nextMatchId = await getNextMatchId();
          const stevanPlayer = playersRes.data?.find(p => p.display_name === "Stevan");
          const maxPlayer = playersRes.data?.find(p => p.display_name === "Max");
          setRows([{
            id: `row-${Date.now()}`,
            matchId: nextMatchId,
            player1: stevanPlayer?.display_name || "",
            player1Bey: "",
            player1Score: "0",
            player2: maxPlayer?.display_name || "",
            player2Bey: "",
            player2Score: "0",
            winner: "",
            date: new Date().toLocaleDateString("en-US"),
            bursts: "0",
            knockouts: "0",
            extremeKnockouts: "0",
            spinFinishes: "0",
          }]);
        }
      } catch (error) {
        console.error("Failed to load CSV:", error);
        // On error, start with a new row
        const nextMatchId = await getNextMatchId();
        const stevanPlayer = playersRes.data?.find(p => p.display_name === "Stevan");
        const maxPlayer = playersRes.data?.find(p => p.display_name === "Max");
        setRows([{
          id: `row-${Date.now()}`,
          matchId: nextMatchId,
          player1: stevanPlayer?.display_name || "",
          player1Bey: "",
          player1Score: "0",
          player2: maxPlayer?.display_name || "",
          player2Bey: "",
          player2Score: "0",
          winner: "",
          date: new Date().toLocaleDateString("en-US"),
          bursts: "0",
          knockouts: "0",
          extremeKnockouts: "0",
          spinFinishes: "0",
        }]);
      }

      setIsLoading(false);
    };

    loadData();
  }, []);

  const addRow = async () => {
    const nextMatchId = await getNextMatchId();
    const stevanPlayer = players.find(p => p.display_name === "Stevan");
    const maxPlayer = players.find(p => p.display_name === "Max");
    const newRow: CsvRow = {
      id: `row-${Date.now()}`,
      matchId: nextMatchId,
      player1: stevanPlayer?.display_name || "",
      player1Bey: "",
      player1Score: "0",
      player2: maxPlayer?.display_name || "",
      player2Bey: "",
      player2Score: "0",
      winner: "",
      date: new Date().toLocaleDateString("en-US"),
      bursts: "0",
      knockouts: "0",
      extremeKnockouts: "0",
      spinFinishes: "0",
    };
    setRows([...rows, newRow]);
  };

  const removeRow = (id: string) => {
    setRows(rows.filter((r) => r.id !== id));
  };

  const updateRow = (id: string, field: keyof CsvRow, value: string) => {
    setRows((prevRows) => {
      return prevRows.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: value };
        // Auto-calculate winner when scores change (only if both scores are non-zero)
        if (field === "player1Score" || field === "player2Score") {
          const score1 = Number(updated.player1Score) || 0;
          const score2 = Number(updated.player2Score) || 0;
          if (score1 === 0 && score2 === 0) {
            updated.winner = "";
          } else if (score1 > score2) {
            updated.winner = updated.player1;
          } else if (score2 > score1) {
            updated.winner = updated.player2;
          } else {
            // Tie - default to player1
            updated.winner = updated.player1;
          }
        }
        return updated;
      });
    });
  };

  const updateRowMultiple = (id: string, updates: Partial<CsvRow>) => {
    setRows((prevRows) => prevRows.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  };

  const getFilteredBeyblades = (row: CsvRow, isPlayer1: boolean) => {
    const playerName = isPlayer1 ? row.player1 : row.player2;
    const playerId = players.find((p) => p.display_name === playerName)?.id;
    
    // If no player selected, return empty
    if (!playerId) return [];
    
    // Get inventory for this player
    const playerInventory = inventoryOptions[playerId] || [];
    
    // Filter by search term if provided
    const filterKey = isPlayer1 ? player1Filter[row.id] || "" : player2Filter[row.id] || "";
    const search = filterKey.toLowerCase();
    
    if (!search) {
      return playerInventory.slice(0, 20);
    }
    
    return playerInventory
      .filter((bey) => {
        const name = bey.name.toLowerCase();
        const normalized = normalizeBeybladeName(bey.name).toLowerCase();
        return name.includes(search) || normalized.includes(search);
      })
      .slice(0, 20);
  };

  const exportCsv = () => {
    const header = "match_id,player1,player1_bey,player1_score,player2,player2_bey,player2_score,winner,date,bursts,knockouts,extreme_knockouts,spin_finishes";
    const csvRows = rows.map((r) =>
      [
        r.matchId,
        r.player1,
        r.player1Bey,
        r.player1Score,
        r.player2,
        r.player2Bey,
        r.player2Score,
        r.winner,
        r.date,
        r.bursts,
        r.knockouts,
        r.extremeKnockouts,
        r.spinFinishes,
      ].join(",")
    );
    const csv = [header, ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "batch-import.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const getNextMatchId = async (): Promise<string> => {
    const { data } = await supabase
      .from("matches")
      .select("external_id")
      .not("external_id", "is", null)
      .order("external_id", { ascending: false })
      .limit(1);
    
    if (!data || data.length === 0) {
      return "match-001";
    }
    
    const lastId = data[0].external_id;
    const match = lastId.match(/match-(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      return `match-${String(num + 1).padStart(3, "0")}`;
    }
    return "match-001";
  };

  const handleImport = async () => {
    if (!isSupabaseConfigured) {
      window.alert("Supabase is not configured.");
      return;
    }

    if (rows.length === 0) {
      window.alert("No rows to import.");
      return;
    }

    setIsImporting(true);
    setImportSummary("Processing...");

    let successCount = 0;
    let updateCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (const row of rows) {
      if (!row.matchId || !row.player1 || !row.player2 || !row.player1Bey || !row.player2Bey) {
        errorCount++;
        errors.push(`Row ${row.id}: Missing required fields`);
        continue;
      }

      const player1Id = players.find((p) => p.display_name === row.player1)?.id;
      const player2Id = players.find((p) => p.display_name === row.player2)?.id;

      if (!player1Id || !player2Id) {
        errorCount++;
        errors.push(`Row ${row.id}: Player not found`);
        continue;
      }

      // Find Beyblades in player inventories
      const player1Bey = (inventoryOptions[player1Id] ?? []).find(
        (bey) => normalizeBeybladeName(bey.name) === normalizeBeybladeName(row.player1Bey)
      );
      const player2Bey = (inventoryOptions[player2Id] ?? []).find(
        (bey) => normalizeBeybladeName(bey.name) === normalizeBeybladeName(row.player2Bey)
      );

      if (!player1Bey || !player2Bey) {
        errorCount++;
        errors.push(`Row ${row.id}: Beyblade not found in player inventory`);
        continue;
      }

      const scoreA = Number(row.player1Score) || 0;
      const scoreB = Number(row.player2Score) || 0;
      // Auto-determine winner from score (higher score wins, tie goes to player1)
      // Only set winner if at least one score is non-zero
      const winnerId = (scoreA === 0 && scoreB === 0) 
        ? null 
        : (scoreA > scoreB ? player1Id : scoreB > scoreA ? player2Id : player1Id);

      // Parse date
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

      // Check if match exists
      const { data: existingMatch } = await supabase
        .from("matches")
        .select("id")
        .eq("external_id", row.matchId)
        .maybeSingle();

      const isUpdate = !!existingMatch;

      // Upsert match
      const { data: matchData, error: matchError } = await supabase
        .from("matches")
        .upsert(
          {
            id: existingMatch?.id,
            external_id: row.matchId,
            played_at: Number.isNaN(playedAt.getTime()) ? new Date().toISOString() : playedAt.toISOString(),
            format: "best_of",
            winner_player_id: winnerId || null,
          },
          { onConflict: "external_id" }
        )
        .select("id")
        .single();

      if (matchError || !matchData) {
        errorCount++;
        errors.push(`Row ${row.id}: ${matchError?.message ?? "Failed to create/update match"}`);
        continue;
      }

      // Delete old participants if updating
      if (isUpdate) {
        await supabase.from("match_participants").delete().eq("match_id", matchData.id);
        await supabase.from("match_events").delete().eq("match_id", matchData.id);
      }

      // Insert participants
      const { error: participantError } = await supabase.from("match_participants").insert([
        {
          match_id: matchData.id,
          player_id: player1Id,
          beyblade_id: player1Bey.beyblade_id,
          score: scoreA,
          is_winner: winnerId === player1Id,
        },
        {
          match_id: matchData.id,
          player_id: player2Id,
          beyblade_id: player2Bey.beyblade_id,
          score: scoreB,
          is_winner: winnerId === player2Id,
        },
      ]);

      if (participantError) {
        errorCount++;
        errors.push(`Row ${row.id}: ${participantError.message}`);
        continue;
      }

      // Insert events
      const bursts = Number(row.bursts) || 0;
      const knockouts = Number(row.knockouts) || 0;
      const extremeKnockouts = Number(row.extremeKnockouts) || 0;
      const spinFinishes = Number(row.spinFinishes) || 0;

      const eventRows = [
        { event_type: "burst", count: bursts },
        { event_type: "knockout", count: knockouts },
        { event_type: "extreme_knockout", count: extremeKnockouts },
        { event_type: "spin_finish", count: spinFinishes },
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
          errorCount++;
          errors.push(`Row ${row.id}: ${eventError.message}`);
          continue;
        }
      }

      if (isUpdate) {
        updateCount++;
      } else {
        successCount++;
      }
    }

    const summary = [
      `Import Complete`,
      `Total rows: ${rows.length}`,
      `✅ Created: ${successCount}`,
      `🔄 Updated: ${updateCount}`,
      `❌ Errors: ${errorCount}`,
      ...(errors.length > 0 ? [`\nErrors:\n${errors.slice(0, 10).join("\n")}${errors.length > 10 ? `\n... and ${errors.length - 10} more` : ""}`] : []),
    ].join("\n");

    setImportSummary(summary);

    // Clear table and prepopulate first row with default players
    const nextMatchId = await getNextMatchId();
    const stevanPlayer = players.find(p => p.display_name === "Stevan");
    const maxPlayer = players.find(p => p.display_name === "Max");
    const newRow: CsvRow = {
      id: `row-${Date.now()}`,
      matchId: nextMatchId,
      player1: stevanPlayer?.display_name || "",
      player1Bey: "",
      player1Score: "0",
      player2: maxPlayer?.display_name || "",
      player2Bey: "",
      player2Score: "0",
      winner: "",
      date: new Date().toLocaleDateString("en-US"),
      bursts: "0",
      knockouts: "0",
      extremeKnockouts: "0",
      spinFinishes: "0",
    };
    setRows([newRow]);
    setPlayer1Filter({});
    setPlayer2Filter({});
    setIsImporting(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-24 pb-12 px-4">
          <div className="container mx-auto text-center">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-24 pb-12 px-4">
        <div className="container mx-auto">
          <div className="mb-8">
            <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-2">
              CSV <span className="text-gradient-primary">Editor</span>
            </h1>
            <p className="text-muted-foreground">
              Edit your battle import CSV with validated Beyblade selection.{" "}
              <Link to="/battle-log" className="text-primary hover:underline">
                Print an offline battle log
              </Link>{" "}
              to fill in battles away from the computer.
            </p>
          </div>

          <div className="mb-4 flex gap-2">
            <Button onClick={addRow} variant="default">
              <Plus className="w-4 h-4 mr-2" />
              Add Row
            </Button>
            <Button onClick={handleImport} variant="default" disabled={isImporting || rows.length === 0}>
              <Upload className="w-4 h-4 mr-2" />
              {isImporting ? "Importing..." : "Import"}
            </Button>
            <Button onClick={exportCsv} variant="outline">
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>

          {importSummary && (
            <div className="mb-4 p-4 rounded-lg bg-secondary border border-border">
              <pre className="text-xs font-mono whitespace-pre-wrap text-foreground">
                {importSummary}
              </pre>
            </div>
          )}

          <div className="rounded-lg border border-border overflow-hidden bg-background">
            <div className="overflow-x-auto max-h-[calc(100vh-300px)]">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-secondary border-b-2 border-border">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-xs font-semibold text-foreground border-r border-border bg-secondary/95">Match ID</th>
                    <th className="px-2 py-1.5 text-left text-xs font-semibold text-foreground border-r border-border bg-secondary/95">Player 1</th>
                    <th className="px-2 py-1.5 text-left text-xs font-semibold text-foreground border-r border-border bg-secondary/95">Bey 1</th>
                    <th className="px-2 py-1.5 text-left text-xs font-semibold text-foreground border-r border-border bg-secondary/95 w-16">Score 1</th>
                    <th className="px-2 py-1.5 text-left text-xs font-semibold text-foreground border-r border-border bg-secondary/95">Player 2</th>
                    <th className="px-2 py-1.5 text-left text-xs font-semibold text-foreground border-r border-border bg-secondary/95">Bey 2</th>
                    <th className="px-2 py-1.5 text-left text-xs font-semibold text-foreground border-r border-border bg-secondary/95 w-16">Score 2</th>
                    <th className="px-2 py-1.5 text-left text-xs font-semibold text-foreground border-r border-border bg-secondary/95">Winner</th>
                    <th className="px-2 py-1.5 text-left text-xs font-semibold text-foreground border-r border-border bg-secondary/95 w-24">Date</th>
                    <th className="px-2 py-1.5 text-left text-xs font-semibold text-foreground border-r border-border bg-secondary/95 w-16">Bursts</th>
                    <th className="px-2 py-1.5 text-left text-xs font-semibold text-foreground border-r border-border bg-secondary/95 w-16">KOs</th>
                    <th className="px-2 py-1.5 text-left text-xs font-semibold text-foreground border-r border-border bg-secondary/95 w-20">Extreme KOs</th>
                    <th className="px-2 py-1.5 text-left text-xs font-semibold text-foreground border-r border-border bg-secondary/95 w-20">Spin Finishes</th>
                    <th className="px-1 py-1.5 text-left text-xs font-semibold text-foreground bg-secondary/95 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="px-4 py-8 text-center text-muted-foreground border-r border-border">
                        No rows yet. Click "Add Row" to get started.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, rowIndex) => {
                      const player1BeyOptions = getFilteredBeyblades(row, true);
                      const player2BeyOptions = getFilteredBeyblades(row, false);
                      const isLastRow = rowIndex === rows.length - 1;

                      return (
                        <tr key={row.id} className="border-b border-border hover:bg-secondary/30">
                          <td className="px-1 py-0.5 border-r border-border">
                            <input
                              value={row.matchId}
                              onChange={(e) => updateRow(row.id, "matchId", e.target.value)}
                              className="w-full h-7 bg-transparent border-0 px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary rounded"
                              placeholder="match-001"
                            />
                          </td>
                          <td className="px-1 py-0.5 border-r border-border">
                            <select
                              value={row.player1}
                              onChange={(e) => {
                                const newValue = e.target.value;
                                updateRowMultiple(row.id, { player1: newValue, player1Bey: "" });
                                setPlayer1Filter((prev) => ({ ...prev, [row.id]: "" }));
                              }}
                              className="w-full h-7 bg-secondary border-0 px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary rounded cursor-pointer"
                            >
                              <option value="">-</option>
                              {players.map((p) => (
                                <option key={p.id} value={p.display_name}>
                                  {p.display_name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-1 py-0.5 border-r border-border">
                            <div className="relative">
                              <input
                                value={row.player1Bey}
                                onChange={(e) => {
                                  updateRow(row.id, "player1Bey", e.target.value);
                                  setPlayer1Filter({ ...player1Filter, [row.id]: e.target.value });
                                }}
                                onFocus={() => {
                                  if (!player1Filter[row.id]) {
                                    setPlayer1Filter({ ...player1Filter, [row.id]: row.player1Bey });
                                  }
                                }}
                                className="w-full h-7 bg-transparent border-0 px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary rounded"
                                placeholder="Type..."
                                list={`bey1-${row.id}`}
                              />
                              <datalist id={`bey1-${row.id}`}>
                                {player1BeyOptions.map((bey) => (
                                  <option key={bey.id} value={bey.name} />
                                ))}
                              </datalist>
                            </div>
                          </td>
                          <td className="px-1 py-0.5 border-r border-border">
                            <input
                              type="number"
                              value={row.player1Score}
                              onChange={(e) => updateRow(row.id, "player1Score", e.target.value)}
                              className="w-full h-7 bg-transparent border-0 px-1.5 text-xs text-foreground text-right focus:outline-none focus:ring-1 focus:ring-primary rounded"
                            />
                          </td>
                          <td className="px-1 py-0.5 border-r border-border">
                            <select
                              value={row.player2}
                              onChange={(e) => {
                                const newValue = e.target.value;
                                updateRowMultiple(row.id, { player2: newValue, player2Bey: "" });
                                setPlayer2Filter((prev) => ({ ...prev, [row.id]: "" }));
                              }}
                              className="w-full h-7 bg-secondary border-0 px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary rounded cursor-pointer"
                            >
                              <option value="">-</option>
                              {players.map((p) => (
                                <option key={p.id} value={p.display_name}>
                                  {p.display_name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-1 py-0.5 border-r border-border">
                            <div className="relative">
                              <input
                                value={row.player2Bey}
                                onChange={(e) => {
                                  updateRow(row.id, "player2Bey", e.target.value);
                                  setPlayer2Filter({ ...player2Filter, [row.id]: e.target.value });
                                }}
                                onFocus={() => {
                                  if (!player2Filter[row.id]) {
                                    setPlayer2Filter({ ...player2Filter, [row.id]: row.player2Bey });
                                  }
                                }}
                                className="w-full h-7 bg-transparent border-0 px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary rounded"
                                placeholder="Type..."
                                list={`bey2-${row.id}`}
                              />
                              <datalist id={`bey2-${row.id}`}>
                                {player2BeyOptions.map((bey) => (
                                  <option key={bey.id} value={bey.name} />
                                ))}
                              </datalist>
                            </div>
                          </td>
                          <td className="px-1 py-0.5 border-r border-border">
                            <input
                              type="number"
                              value={row.player2Score}
                              onChange={(e) => updateRow(row.id, "player2Score", e.target.value)}
                              className="w-full h-7 bg-transparent border-0 px-1.5 text-xs text-foreground text-right focus:outline-none focus:ring-1 focus:ring-primary rounded"
                            />
                          </td>
                          <td className="px-1 py-0.5 border-r border-border">
                            <input
                              type="text"
                              value={(() => {
                                const score1 = Number(row.player1Score) || 0;
                                const score2 = Number(row.player2Score) || 0;
                                if (score1 === 0 && score2 === 0) return "";
                                if (score1 > score2) return row.player1;
                                if (score2 > score1) return row.player2;
                                return row.player1; // Tie
                              })()}
                              readOnly
                              className="w-full h-7 bg-secondary/50 border-0 px-1.5 text-xs text-foreground rounded cursor-not-allowed"
                              title="Winner is automatically determined by score"
                              placeholder="-"
                            />
                          </td>
                          <td className="px-1 py-0.5 border-r border-border">
                            <input
                              value={row.date}
                              onChange={(e) => updateRow(row.id, "date", e.target.value)}
                              className="w-full h-7 bg-transparent border-0 px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary rounded"
                              placeholder="2/3/2026"
                            />
                          </td>
                          <td className="px-1 py-0.5 border-r border-border">
                            <input
                              type="number"
                              value={row.bursts}
                              onChange={(e) => updateRow(row.id, "bursts", e.target.value)}
                              className="w-full h-7 bg-transparent border-0 px-1.5 text-xs text-foreground text-right focus:outline-none focus:ring-1 focus:ring-primary rounded"
                            />
                          </td>
                          <td className="px-1 py-0.5 border-r border-border">
                            <input
                              type="number"
                              value={row.knockouts}
                              onChange={(e) => updateRow(row.id, "knockouts", e.target.value)}
                              className="w-full h-7 bg-transparent border-0 px-1.5 text-xs text-foreground text-right focus:outline-none focus:ring-1 focus:ring-primary rounded"
                            />
                          </td>
                          <td className="px-1 py-0.5 border-r border-border">
                            <input
                              type="number"
                              value={row.extremeKnockouts}
                              onChange={(e) => updateRow(row.id, "extremeKnockouts", e.target.value)}
                              className="w-full h-7 bg-transparent border-0 px-1.5 text-xs text-foreground text-right focus:outline-none focus:ring-1 focus:ring-primary rounded"
                            />
                          </td>
                          <td className="px-1 py-0.5 border-r border-border">
                            <input
                              type="number"
                              value={row.spinFinishes}
                              onChange={(e) => updateRow(row.id, "spinFinishes", e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && isLastRow) {
                                  e.preventDefault();
                                  addRow();
                                }
                              }}
                              className="w-full h-7 bg-transparent border-0 px-1.5 text-xs text-foreground text-right focus:outline-none focus:ring-1 focus:ring-primary rounded"
                            />
                          </td>
                          <td className="px-1 py-0.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeRow(row.id)}
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
