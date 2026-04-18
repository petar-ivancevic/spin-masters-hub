import { useCallback, useEffect, useMemo, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { BeybladeCard } from "@/components/BeybladeCard";
import { Button } from "@/components/ui/button";
import { Plus, Search, Filter, Grid, List } from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";

type FilterType = "all" | "Attack" | "Defense" | "Stamina" | "Balance";
type BeyType = Exclude<FilterType, "all">;

type BeybladeRow = {
  id: string;
  name: string;
  type: string;
  attack: number | null;
  defense: number | null;
  stamina: number | null;
};

type BeybladeWithStats = BeybladeRow & {
  type: BeyType;
  wins: number;
  losses: number;
  notes: string | null;
  playerBeybladeId: string;
};

type PlayerRow = {
  id: string;
  display_name: string;
};

type PlayerBeybladeRow = {
  id: string;
  player_id: string;
  beyblade_id: string;
  attack: number | null;
  defense: number | null;
  stamina: number | null;
  notes: string | null;
  beyblades: BeybladeRow | null;
};

const allowedTypes: BeyType[] = ["Attack", "Defense", "Stamina", "Balance"];

export default function Inventory() {
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  const [catalog, setCatalog] = useState<BeybladeRow[]>([]);
  const [inventoryEntries, setInventoryEntries] = useState<PlayerBeybladeRow[]>([]);
  const [beyblades, setBeyblades] = useState<BeybladeWithStats[]>([]);
  const [playerRecord, setPlayerRecord] = useState({ wins: 0, losses: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCatalogBey, setSelectedCatalogBey] = useState<string>("");
  const [newBladerName, setNewBladerName] = useState("");
  const [newCatalogName, setNewCatalogName] = useState("");
  const [newCatalogType, setNewCatalogType] = useState<BeyType>("Balance");
  const [statsDrafts, setStatsDrafts] = useState<
    Record<string, { attack: string; defense: string; stamina: string }>
  >({});
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({});

  const loadBaseData = useCallback(async () => {
    setIsLoading(true);

    const [{ data: playerData, error: playerError }, { data: beyData, error: beyError }] =
      await Promise.all([
        supabase
          .from("players")
          .select("id, display_name")
          .order("display_name", { ascending: true }),
        supabase
          .from("beyblades")
          .select("id, name, type, attack, defense, stamina")
          .order("name", { ascending: true }),
      ]);

    if (playerError) {
      console.error("Failed to load players:", playerError);
    }

    if (beyError) {
      console.error("Failed to load beyblades:", beyError);
    }

    setPlayers(playerData ?? []);
    setCatalog(beyData ?? []);
    setSelectedPlayerId((current) => current || playerData?.[0]?.id || "");
    setIsLoading(false);
  }, []);

  const loadPlayerInventory = useCallback(
    async (playerId: string) => {
      if (!playerId) {
        setInventoryEntries([]);
        setBeyblades([]);
        setPlayerRecord({ wins: 0, losses: 0 });
        return;
      }

      setIsLoading(true);

      // Try to fetch with notes first, fall back to without notes if column doesn't exist
      let inventoryData: any[] | null = null;
      let inventoryError: any = null;
      
      const inventoryWithNotes = await supabase
        .from("player_beyblades")
        .select(
          "id, player_id, beyblade_id, attack, defense, stamina, notes, beyblades(id, name, type, attack, defense, stamina)"
        )
        .eq("player_id", playerId);
      
      // If notes column doesn't exist (error code 42703 or message contains "notes"), try without it
      if (inventoryWithNotes.error && (
        inventoryWithNotes.error.code === "42703" || 
        inventoryWithNotes.error.message?.toLowerCase().includes("notes") ||
        inventoryWithNotes.error.message?.toLowerCase().includes("column")
      )) {
        console.warn("Notes column not found, falling back to query without notes:", inventoryWithNotes.error);
        const inventoryWithoutNotes = await supabase
          .from("player_beyblades")
          .select(
            "id, player_id, beyblade_id, attack, defense, stamina, beyblades(id, name, type, attack, defense, stamina)"
          )
          .eq("player_id", playerId);
        inventoryData = inventoryWithoutNotes.data;
        inventoryError = inventoryWithoutNotes.error;
        // Add null notes to each entry for compatibility
        if (inventoryData) {
          inventoryData = inventoryData.map(entry => ({ ...entry, notes: null }));
        }
      } else {
        inventoryData = inventoryWithNotes.data;
        inventoryError = inventoryWithNotes.error;
      }

      const { data: battleRows, error: battleError } = await supabase
        .from("match_participants")
        .select("is_winner, beyblade_id, matches!inner(format)")
        .eq("player_id", playerId);

      if (inventoryError) {
        console.error("Failed to load inventory:", inventoryError);
      }

      if (battleError) {
        console.error("Failed to load battle stats:", battleError);
      }

      type BattleRow = {
        is_winner: boolean;
        beyblade_id: string | null;
        matches: { format: string } | null;
      };

      const rows = (battleRows ?? []) as BattleRow[];

      const record = rows
        .filter((entry) => entry.matches?.format !== "tournament")
        .reduce(
          (acc, entry) => {
            if (entry.is_winner) {
              acc.wins += 1;
            } else {
              acc.losses += 1;
            }
            return acc;
          },
          { wins: 0, losses: 0 }
        );

      // Per-bey W/L includes tournament bracket battles
      const statsByBey = new Map<string, { wins: number; losses: number }>();
      rows.forEach((participant) => {
        if (!participant.beyblade_id) return;
        const current = statsByBey.get(participant.beyblade_id) ?? { wins: 0, losses: 0 };
        if (participant.is_winner) {
          current.wins += 1;
        } else {
          current.losses += 1;
        }
        statsByBey.set(participant.beyblade_id, current);
      });

      const normalized = (inventoryData ?? [])
        .map((entry) => {
          if (!entry.beyblades) return null;
          const base = entry.beyblades;
          const normalizedType = allowedTypes.includes(base.type as BeyType)
            ? (base.type as BeyType)
            : "Balance";
          const attack = entry.attack ?? base.attack ?? null;
          const defense = entry.defense ?? base.defense ?? null;
          const stamina = entry.stamina ?? base.stamina ?? null;
          const stats = statsByBey.get(base.id) ?? { wins: 0, losses: 0 };

          return {
            ...base,
            attack,
            defense,
            stamina,
            type: normalizedType,
            wins: stats.wins,
            losses: stats.losses,
            notes: entry.notes ?? null,
            playerBeybladeId: entry.id,
          } satisfies BeybladeWithStats;
        })
        .filter((entry): entry is BeybladeWithStats => Boolean(entry));

      setInventoryEntries(inventoryData ?? []);
      setBeyblades(normalized);
      setPlayerRecord(record);
      setIsLoading(false);
    },
    []
  );

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    loadBaseData().catch((error) => {
      console.error("Failed to load inventory:", error);
      if (isMounted) {
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [loadBaseData]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!selectedPlayerId) return;

    let isMounted = true;

    loadPlayerInventory(selectedPlayerId).catch((error) => {
      console.error("Failed to load player inventory:", error);
      if (isMounted) {
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [loadPlayerInventory, selectedPlayerId]);

  const handleAddBeyblade = async () => {
    if (!isSupabaseConfigured) return;

    const trimmed = newCatalogName.trim();
    if (!trimmed) {
      window.alert("Enter a Beyblade name.");
      return;
    }

    const { data, error } = await supabase
      .from("beyblades")
      .insert({
        name: trimmed,
        type: newCatalogType,
        attack: null,
        defense: null,
        stamina: null,
      })
      .select("id, name, type, attack, defense, stamina")
      .single();

    if (error) {
      console.error("Failed to add beyblade:", error);
      window.alert("Could not add that Beyblade. It might already exist.");
      return;
    }

    setCatalog((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    setNewCatalogName("");
  };

  const handleAddStats = async (beyId: string) => {
    if (!isSupabaseConfigured) return;
    const inventoryEntry = inventoryEntries.find((entry) => entry.beyblade_id === beyId);
    if (!inventoryEntry) return;

    const draft = statsDrafts[beyId];
    if (!draft) {
      window.alert("Enter stats before saving.");
      return;
    }

    const attack = Number(draft.attack);
    const defense = Number(draft.defense);
    const stamina = Number(draft.stamina);

    const isValid = (value: number) => Number.isFinite(value) && value >= 0 && value <= 100;
    if (!isValid(attack) || !isValid(defense) || !isValid(stamina)) {
      window.alert("Please enter numbers between 0 and 100.");
      return;
    }

    const { error } = await supabase
      .from("player_beyblades")
      .update({ attack, defense, stamina })
      .eq("id", inventoryEntry.id);

    if (error) {
      console.error("Failed to update stats:", error);
      window.alert("Could not update stats. Please try again.");
      return;
    }

    setInventoryEntries((prev) =>
      prev.map((entry) =>
        entry.id === inventoryEntry.id ? { ...entry, attack, defense, stamina } : entry
      )
    );
    setBeyblades((prev) =>
      prev.map((bey) => (bey.id === beyId ? { ...bey, attack, defense, stamina } : bey))
    );
    setStatsDrafts((prev) => {
      const next = { ...prev };
      delete next[beyId];
      return next;
    });
  };

  const handleSaveNotes = async (beyId: string) => {
    if (!isSupabaseConfigured) return;
    const inventoryEntry = inventoryEntries.find((entry) => entry.beyblade_id === beyId);
    if (!inventoryEntry) return;

    const text = (notesDrafts[beyId] ?? "").trim();
    const notesValue = text.length > 0 ? text : null;

    const { error } = await supabase
      .from("player_beyblades")
      .update({ notes: notesValue })
      .eq("id", inventoryEntry.id);

    if (error) {
      console.error("Failed to save notes:", error);
      window.alert(
        "Could not save notes. In Supabase, run SQL on player_beyblades:\n\n" +
          "alter table public.player_beyblades add column if not exists notes text;"
      );
      return;
    }

    setInventoryEntries((prev) =>
      prev.map((entry) =>
        entry.id === inventoryEntry.id ? { ...entry, notes: notesValue } : entry
      )
    );
    setBeyblades((prev) =>
      prev.map((bey) => (bey.id === beyId ? { ...bey, notes: notesValue } : bey))
    );
  };

  const handleAddPlayer = async () => {
    if (!isSupabaseConfigured) return;

    const trimmed = newBladerName.trim();
    if (!trimmed) {
      window.alert("Enter a blader name.");
      return;
    }

    const { data, error } = await supabase
      .from("players")
      .insert({ display_name: trimmed })
      .select("id, display_name")
      .single();

    if (error) {
      console.error("Failed to add player:", error);
      window.alert("Could not add that blader. It might already exist.");
      return;
    }

    setPlayers((prev) => [...prev, data].sort((a, b) => a.display_name.localeCompare(b.display_name)));
    setSelectedPlayerId(data.id);
    setNewBladerName("");
  };

  const handleAddToInventory = async () => {
    if (!isSupabaseConfigured || !selectedPlayerId || !selectedCatalogBey) return;

    const { data, error } = await supabase
      .from("player_beyblades")
      .insert({
        player_id: selectedPlayerId,
        beyblade_id: selectedCatalogBey,
      })
      .select(
        "id, player_id, beyblade_id, attack, defense, stamina, beyblades(id, name, type, attack, defense, stamina)"
      )
      .single();

    if (error) {
      console.error("Failed to add to inventory:", error);
      window.alert("Could not add that Beyblade to the inventory.");
      return;
    }

    setInventoryEntries((prev) => [...prev, data]);
    if (data.beyblades) {
      const normalizedType = allowedTypes.includes(data.beyblades.type as BeyType)
        ? (data.beyblades.type as BeyType)
        : "Balance";
      setBeyblades((prev) => [
        ...prev,
        {
          ...data.beyblades,
          type: normalizedType,
          wins: 0,
          losses: 0,
        },
      ]);
    }
    setSelectedCatalogBey("");
  };

  const filteredBeyblades = beyblades.filter((b) => {
    const matchesFilter = filter === "all" || b.type === filter;
    const matchesSearch = b.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const totalWins = playerRecord.wins;
  const totalLosses = playerRecord.losses;
  const totalBattles = totalWins + totalLosses;
  const overallWinRate = totalBattles > 0 ? Math.round((totalWins / totalBattles) * 100) : 0;

  const availableCatalog = useMemo(() => {
    const ownedIds = new Set(inventoryEntries.map((entry) => entry.beyblade_id));
    return catalog.filter((bey) => !ownedIds.has(bey.id));
  }, [catalog, inventoryEntries]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="pt-24 pb-12 px-4">
        <div className="container mx-auto">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
            <div>
              <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-2">
                Blader <span className="text-gradient-accent">Inventory</span>
              </h1>
              <p className="text-muted-foreground">
                {beyblades.length} Beyblades • {overallWinRate}% Win Rate
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex items-center gap-2">
                <input
                  value={newBladerName}
                  onChange={(event) => setNewBladerName(event.target.value)}
                  placeholder="New blader name"
                  className="h-10 rounded-lg bg-secondary border border-border px-3 text-sm text-foreground"
                />
                <Button variant="outline" onClick={handleAddPlayer}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Blader
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={newCatalogName}
                  onChange={(event) => setNewCatalogName(event.target.value)}
                  placeholder="New Beyblade name"
                  className="h-10 rounded-lg bg-secondary border border-border px-3 text-sm text-foreground"
                />
                <select
                  value={newCatalogType}
                  onChange={(event) => setNewCatalogType(event.target.value as BeyType)}
                  className="h-10 rounded-lg bg-secondary border border-border px-3 text-sm text-foreground"
                >
                  {allowedTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <Button variant="default" onClick={handleAddBeyblade}>
              <Plus className="w-4 h-4 mr-2" />
                  Add Bey to Catalog
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-4 mb-8">
            <div className="flex flex-1 flex-col sm:flex-row gap-2">
              <div className="flex flex-1 flex-col">
                <label className="text-xs text-muted-foreground mb-1">Select Blader</label>
                <select
                  value={selectedPlayerId}
                  onChange={(event) => setSelectedPlayerId(event.target.value)}
                  className="h-10 rounded-lg bg-secondary border border-border px-3 text-sm text-foreground"
                >
                  <option value="">Choose a blader...</option>
                  {players.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.display_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-1 flex-col">
                <label className="text-xs text-muted-foreground mb-1">Add Bey to Inventory</label>
                <div className="flex gap-2">
                  <select
                    value={selectedCatalogBey}
                    onChange={(event) => setSelectedCatalogBey(event.target.value)}
                    className="h-10 flex-1 rounded-lg bg-secondary border border-border px-3 text-sm text-foreground"
                  >
                    <option value="">Select a Beyblade...</option>
                    {availableCatalog.map((bey) => (
                      <option key={bey.id} value={bey.id}>
                        {bey.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="default"
                    onClick={handleAddToInventory}
                    disabled={!selectedCatalogBey || !selectedPlayerId}
                  >
                    Add
            </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Stats Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="rounded-lg bg-gradient-card border border-border p-4 text-center">
              <div className="font-display text-2xl font-bold text-foreground">{beyblades.length}</div>
              <div className="text-sm text-muted-foreground">Inventory Beys</div>
            </div>
            <div className="rounded-lg bg-gradient-card border border-border p-4 text-center">
              <div className="font-display text-2xl font-bold text-green-400">{totalWins}</div>
              <div className="text-sm text-muted-foreground">Total Wins</div>
            </div>
            <div className="rounded-lg bg-gradient-card border border-border p-4 text-center">
              <div className="font-display text-2xl font-bold text-red-400">{totalLosses}</div>
              <div className="text-sm text-muted-foreground">Total Losses</div>
            </div>
            <div className="rounded-lg bg-gradient-card border border-border p-4 text-center">
              <div className="font-display text-2xl font-bold text-primary">{overallWinRate}%</div>
              <div className="text-sm text-muted-foreground">Win Rate</div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 mb-8">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search your collection..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-10 pl-10 pr-4 rounded-lg bg-secondary border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Type Filter */}
            <div className="flex gap-2 flex-wrap">
              {(["all", "Attack", "Defense", "Stamina", "Balance"] as FilterType[]).map((type) => (
                <Button
                  key={type}
                  variant={filter === type ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilter(type)}
                >
                  {type === "all" ? "All Types" : type}
                </Button>
              ))}
            </div>

            {/* View Toggle */}
            <div className="flex gap-1 border border-border rounded-lg p-1">
              <Button
                variant={viewMode === "grid" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("grid")}
              >
                <Grid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("list")}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Inventory Grid */}
          <div className={viewMode === "grid" 
            ? "grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
            : "space-y-4"
          }>
            {filteredBeyblades.map((bey) => {
              const needsStats =
                bey.attack === null || bey.defense === null || bey.stamina === null;
              const draft = statsDrafts[bey.id] ?? { attack: "", defense: "", stamina: "" };
              const notesDraft = notesDrafts[bey.id] ?? bey.notes ?? "";

              return (
                <div key={bey.id} className={viewMode === "list" ? "space-y-2" : ""}>
                  <BeybladeCard {...bey} />
                  {needsStats && (
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <input
                        value={draft.attack}
                        onChange={(event) =>
                          setStatsDrafts((prev) => ({
                            ...prev,
                            [bey.id]: { ...draft, attack: event.target.value },
                          }))
                        }
                        className="h-9 rounded-lg bg-secondary border border-border px-2 text-xs text-foreground"
                        placeholder="ATK"
                      />
                      <input
                        value={draft.defense}
                        onChange={(event) =>
                          setStatsDrafts((prev) => ({
                            ...prev,
                            [bey.id]: { ...draft, defense: event.target.value },
                          }))
                        }
                        className="h-9 rounded-lg bg-secondary border border-border px-2 text-xs text-foreground"
                        placeholder="DEF"
                      />
                      <input
                        value={draft.stamina}
                        onChange={(event) =>
                          setStatsDrafts((prev) => ({
                            ...prev,
                            [bey.id]: { ...draft, stamina: event.target.value },
                          }))
                        }
                        className="h-9 rounded-lg bg-secondary border border-border px-2 text-xs text-foreground"
                        placeholder="STA"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="col-span-3"
                        onClick={() => handleAddStats(bey.id)}
                      >
                        Save Performance Stats
                      </Button>
                    </div>
                  )}
                  <div className="mt-2">
                    <textarea
                      value={notesDraft}
                      onChange={(event) =>
                        setNotesDrafts((prev) => ({
                          ...prev,
                          [bey.id]: event.target.value,
                        }))
                      }
                      className="w-full min-h-[60px] rounded-lg bg-secondary border border-border px-2 py-1.5 text-xs text-foreground resize-y"
                      placeholder="Add notes about this Beyblade..."
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-1"
                      onClick={() => handleSaveNotes(bey.id)}
                    >
                      Save Notes
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {!isLoading && filteredBeyblades.length === 0 && (
            <div className="text-center py-20">
              <Filter className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                No Beyblades found matching your criteria
              </p>
            </div>
          )}

          {isLoading && (
            <div className="text-center py-20">
              <p className="text-muted-foreground">Loading inventory...</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
