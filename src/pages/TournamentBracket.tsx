import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import {
  buildDoubleEliminationFourPlans,
  buildSingleEliminationPlans,
  keyFor,
  nextPow2,
} from "@/lib/tournamentBracket";
import { ChevronDown, ChevronUp, Shuffle, Trophy, RefreshCw } from "lucide-react";

type TournamentRow = {
  id: string;
  name: string;
  elimination_type: "single" | "double";
  status: string;
  started_at: string | null;
  finished_at: string | null;
};

type RoundMatchRow = {
  id: string;
  tournament_id: string;
  bracket_side: "winners" | "losers" | "grand";
  round_index: number;
  match_index: number;
  player_a_id: string | null;
  player_b_id: string | null;
  beyblade_a_id: string | null;
  beyblade_b_id: string | null;
  winner_player_id: string | null;
  winner_beyblade_id: string | null;
  match_id: string | null;
  feed_a_from: string | null;
  feed_b_from: string | null;
  loser_feed_a_from: string | null;
  loser_feed_b_from: string | null;
  player_b_from_loser_of: string | null;
};

type CatalogBey = { id: string; name: string };

type PropagateFromNodeFn = (
  tournamentId: string,
  completed: RoundMatchRow,
  winnerBeyId: string,
  loserBeyId: string | null
) => Promise<void>;

/** Double elim layout uses exactly this many beys (6 scheduled matches). */
const DOUBLE_ELIM_BEY_COUNT = 4;
/** Soft guardrail: confirm before creating very large single-elim brackets. */
const LARGE_BRACKET_SLOT_WARN = 32;
const LARGE_BRACKET_ENTRANT_WARN = 64;

function shuffleInPlace<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function pickRandomDistinctBeyIds(inventory: CatalogBey[], count: number): string[] {
  if (inventory.length === 0 || count < 1) return [];
  const shuffled = shuffleInPlace(inventory);
  return shuffled.slice(0, Math.min(count, inventory.length)).map((b) => b.id);
}

/** Process winners rounds before losers then grand so batch logging respects feed order. */
function bracketBatchSortOrder(a: RoundMatchRow, b: RoundMatchRow): number {
  const sideRank = (s: RoundMatchRow["bracket_side"]) => (s === "winners" ? 0 : s === "losers" ? 1 : 2);
  const d = sideRank(a.bracket_side) - sideRank(b.bracket_side);
  if (d !== 0) return d;
  if (a.round_index !== b.round_index) return a.round_index - b.round_index;
  return a.match_index - b.match_index;
}

export default function TournamentBracket() {
  /** Beys that appear in at least one blader inventory (tournament picker only). */
  const [inventoryBeys, setInventoryBeys] = useState<CatalogBey[]>([]);
  /** Display names for any bey id shown in the bracket (includes older tournaments). */
  const [beyNamesById, setBeyNamesById] = useState<Record<string, string>>({});
  /** First inventory owner per bey (for match_participants only). */
  const [ownerByBeybladeId, setOwnerByBeybladeId] = useState<Record<string, string>>({});
  const [tournaments, setTournaments] = useState<TournamentRow[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string>("");
  const [nodes, setNodes] = useState<RoundMatchRow[]>([]);
  const [entryOwners, setEntryOwners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("Bey Tournament");
  const [elimType, setElimType] = useState<"single" | "double">("single");
  const [selectedBeyIds, setSelectedBeyIds] = useState<string[]>([]);

  /** Per open bracket node: which side wins (1 pt vs 0); tournament logging only. */
  const [draftWinnerSide, setDraftWinnerSide] = useState<Record<string, "a" | "b">>({});
  /** When true, create form is hidden (auto after pick/create tournament). */
  const [createPanelCollapsed, setCreatePanelCollapsed] = useState(false);
  const [batchLogBusy, setBatchLogBusy] = useState(false);

  const propagateFromNodeRef = useRef<PropagateFromNodeFn | null>(null);

  const beyName = useCallback(
    (id: string | null) => (id ? beyNamesById[id] ?? "Bey" : "TBD"),
    [beyNamesById]
  );

  const loadInventoryBeysAndOwners = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data: inv } = await supabase
      .from("player_beyblades")
      .select("player_id, beyblade_id, beyblades(id, name)")
      .order("created_at", { ascending: false });

    const ownerMap: Record<string, string> = {};
    const seen = new Set<string>();
    const list: CatalogBey[] = [];
    const names: Record<string, string> = {};

    (inv ?? []).forEach((row: { player_id: string; beyblade_id: string; beyblades?: { name?: string } | null }) => {
      const bid = row.beyblade_id;
      if (!bid) return;
      if (!ownerMap[bid]) ownerMap[bid] = row.player_id;
      const nm = row.beyblades?.name ?? "Unknown";
      names[bid] = nm;
      if (!seen.has(bid)) {
        seen.add(bid);
        list.push({ id: bid, name: nm });
      }
    });
    list.sort((a, b) => a.name.localeCompare(b.name));
    setInventoryBeys(list);
    setOwnerByBeybladeId(ownerMap);
    setBeyNamesById((prev) => ({ ...prev, ...names }));
  }, []);

  const loadTournaments = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data, error: e } = await supabase
      .from("tournaments")
      .select("id, name, elimination_type, status, started_at, finished_at")
      .order("created_at", { ascending: false });
    if (e) {
      if (e.message?.includes("tournaments") || e.code === "42P01") {
        setError("Run Supabase migrations for tournament tables.");
      }
      return;
    }
    setTournaments((data as TournamentRow[]) ?? []);
  }, []);

  const loadBracket = useCallback(async (tournamentId: string) => {
    if (!tournamentId || !isSupabaseConfigured) return;
    const [{ data: nData, error: ne }, { data: eData }] = await Promise.all([
      supabase
        .from("tournament_round_matches")
        .select("*")
        .eq("tournament_id", tournamentId)
        .order("bracket_side", { ascending: true })
        .order("round_index", { ascending: true })
        .order("match_index", { ascending: true }),
      supabase.from("tournament_entries").select("beyblade_id, owner_player_id").eq("tournament_id", tournamentId),
    ]);
    if (ne) {
      console.error(ne);
      return;
    }
    const rows = (nData as RoundMatchRow[]) ?? [];
    setNodes(rows);

    const ids = new Set<string>();
    for (const n of rows) {
      if (n.beyblade_a_id) ids.add(n.beyblade_a_id);
      if (n.beyblade_b_id) ids.add(n.beyblade_b_id);
      if (n.winner_beyblade_id) ids.add(n.winner_beyblade_id);
    }
    if (ids.size > 0) {
      const { data: bn } = await supabase.from("beyblades").select("id, name").in("id", [...ids]);
      setBeyNamesById((prev) => {
        const next = { ...prev };
        (bn as { id: string; name: string }[] | null)?.forEach((b) => {
          next[b.id] = b.name;
        });
        return next;
      });
    }
    const eo: Record<string, string> = {};
    (eData ?? []).forEach((r: { beyblade_id: string | null; owner_player_id: string | null }) => {
      if (r.beyblade_id && r.owner_player_id) eo[r.beyblade_id] = r.owner_player_id;
    });
    setEntryOwners(eo);
  }, []);

  const ownerForBey = useCallback(
    (beyId: string | null) => {
      if (!beyId) return null;
      return entryOwners[beyId] ?? ownerByBeybladeId[beyId] ?? null;
    },
    [entryOwners, ownerByBeybladeId]
  );

  const activeTournament = useMemo(
    () => tournaments.find((t) => t.id === selectedTournamentId),
    [tournaments, selectedTournamentId]
  );

  const singleElimBracketSummary = useMemo(() => {
    if (activeTournament?.elimination_type !== "single") return null;
    const entrantCount = Object.keys(entryOwners).length;
    if (entrantCount < 2) return null;
    const slots = nextPow2(entrantCount);
    return { entrantCount, slots, byes: slots - entrantCount };
  }, [activeTournament?.elimination_type, entryOwners]);

  const largeCreateBracketPreview = useMemo(() => {
    if (elimType !== "single" || selectedBeyIds.length < 2) return null;
    const n = selectedBeyIds.length;
    const P = nextPow2(n);
    if (P > LARGE_BRACKET_SLOT_WARN || n > LARGE_BRACKET_ENTRANT_WARN) {
      return { n, P, byes: P - n };
    }
    return null;
  }, [elimType, selectedBeyIds]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      await loadInventoryBeysAndOwners();
      await loadTournaments();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [loadInventoryBeysAndOwners, loadTournaments]);

  useEffect(() => {
    if (selectedTournamentId) loadBracket(selectedTournamentId);
    else {
      setNodes([]);
      setEntryOwners({});
    }
  }, [selectedTournamentId, loadBracket]);

  useEffect(() => {
    if (selectedTournamentId) setCreatePanelCollapsed(true);
    else setCreatePanelCollapsed(false);
  }, [selectedTournamentId]);

  const toggleBey = (id: string) => {
    setSelectedBeyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const createTournament = async () => {
    if (!isSupabaseConfigured) return;
    const ids = [...selectedBeyIds];
    if (ids.length < 2) {
      window.alert("Select at least 2 beys for the tournament.");
      return;
    }
    for (const bid of ids) {
      if (!ownerByBeybladeId[bid]) {
        window.alert(`"${beyName(bid)}" has no inventory owner — pick beys from the inventory list only.`);
        return;
      }
    }
    if (elimType === "double" && ids.length !== 4) {
      window.alert("Double elimination requires exactly 4 beys. Use single elimination for other sizes.");
      return;
    }

    if (elimType === "single") {
      const P = nextPow2(Math.max(2, ids.length));
      if (P > LARGE_BRACKET_SLOT_WARN || ids.length > LARGE_BRACKET_ENTRANT_WARN) {
        const byeCount = P - ids.length;
        const ok = window.confirm(
          `Large single-elimination bracket: ${ids.length} entrants → ${P} slots (${byeCount} bye${byeCount === 1 ? "" : "s"}). Create anyway?`
        );
        if (!ok) return;
      }
    }

    try {
      const { data: t, error: te } = await supabase
        .from("tournaments")
        .insert({
          name: newName.trim() || "Tournament",
          elimination_type: elimType,
          status: "in_progress",
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (te || !t) throw te ?? new Error("Failed to create tournament");

      const tid = t.id as string;

      for (let i = 0; i < ids.length; i++) {
        const bid = ids[i]!;
        const oid = ownerByBeybladeId[bid]!;
        await supabase.from("tournament_entries").insert({
          tournament_id: tid,
          beyblade_id: bid,
          owner_player_id: oid,
          player_id: oid,
          seed_order: i,
        });
      }

      const idByKey = new Map<string, string>();

      const rowPayload = (
        p: ReturnType<typeof buildSingleEliminationPlans>[0],
        extras: Record<string, unknown>
      ) => ({
        tournament_id: tid,
        bracket_side: p.bracket_side,
        round_index: p.round_index,
        match_index: p.match_index,
        beyblade_a_id: p.beyblade_a_id,
        beyblade_b_id: p.beyblade_b_id,
        player_a_id: p.beyblade_a_id ? ownerByBeybladeId[p.beyblade_a_id] ?? null : null,
        player_b_id: p.beyblade_b_id ? ownerByBeybladeId[p.beyblade_b_id] ?? null : null,
        feed_a_from: null as string | null,
        feed_b_from: null as string | null,
        loser_feed_a_from: null,
        loser_feed_b_from: null,
        player_b_from_loser_of: null,
        ...extras,
      });

      if (elimType === "single") {
        const plans = buildSingleEliminationPlans(ids);
        const maxR = Math.max(...plans.map((p) => p.round_index), 0);
        for (let r = 0; r <= maxR; r++) {
          const inRound = plans.filter((p) => p.round_index === r);
          const rows = inRound.map((p) => {
            const extras: Record<string, unknown> = {};
            if (r > 0) {
              extras.feed_a_from = idByKey.get(keyFor("winners", r - 1, 2 * p.match_index));
              extras.feed_b_from = idByKey.get(keyFor("winners", r - 1, 2 * p.match_index + 1));
            }
            return rowPayload(p, extras);
          });
          const { data: inserted, error: re } = await supabase
            .from("tournament_round_matches")
            .insert(rows)
            .select("id, match_index");
          if (re || !inserted || inserted.length !== inRound.length) {
            throw re ?? new Error("Failed to insert bracket matches for a round");
          }
          const idByMatchIndex = new Map(
            (inserted as { id: string; match_index: number }[]).map((row) => [row.match_index, row.id])
          );
          for (const p of inRound) {
            const rowId = idByMatchIndex.get(p.match_index);
            if (!rowId) throw new Error("Missing inserted match id for round");
            idByKey.set(keyFor("winners", p.round_index, p.match_index), rowId);
          }
        }

        for (let guard = 0; guard < 128; guard++) {
          const { data: br } = await supabase
            .from("tournament_round_matches")
            .select("*")
            .eq("tournament_id", tid);
          const brList = (br as RoundMatchRow[]) ?? [];
          const byeNode = brList.find(
            (n) =>
              !n.winner_beyblade_id &&
              n.bracket_side === "winners" &&
              n.round_index === 0 &&
              ((n.beyblade_a_id && !n.beyblade_b_id) || (!n.beyblade_a_id && n.beyblade_b_id))
          );
          if (!byeNode) break;
          const soleBey = byeNode.beyblade_a_id ?? byeNode.beyblade_b_id!;
          const wp = ownerByBeybladeId[soleBey] ?? null;
          await supabase
            .from("tournament_round_matches")
            .update({ winner_beyblade_id: soleBey, winner_player_id: wp })
            .eq("id", byeNode.id);
          const flush = propagateFromNodeRef.current;
          if (!flush) throw new Error("Bracket propagation not ready.");
          await flush(tid, { ...byeNode, winner_beyblade_id: soleBey }, soleBey, null);
        }
      } else {
        const plans = buildDoubleEliminationFourPlans(ids);
        const wb00 = plans[0]!;
        const wb01 = plans[1]!;
        const wb10 = plans[2]!;
        const lb00 = plans[3]!;
        const lb10 = plans[4]!;
        const gr = plans[5]!;

        for (const p of [wb00, wb01]) {
          const { data: row, error: e } = await supabase
            .from("tournament_round_matches")
            .insert(rowPayload(p, {}))
            .select("id")
            .single();
          if (e || !row) throw e;
          idByKey.set(keyFor("winners", p.round_index, p.match_index), row.id as string);
        }

        const { data: r10, error: e10 } = await supabase
          .from("tournament_round_matches")
          .insert(
            rowPayload(wb10, {
              feed_a_from: idByKey.get(keyFor("winners", 0, 0)),
              feed_b_from: idByKey.get(keyFor("winners", 0, 1)),
            })
          )
          .select("id")
          .single();
        if (e10 || !r10) throw e10;
        idByKey.set(keyFor("winners", 1, 0), r10.id as string);

        const { data: rl0, error: el0 } = await supabase
          .from("tournament_round_matches")
          .insert(
            rowPayload(lb00, {
              loser_feed_a_from: idByKey.get(keyFor("winners", 0, 0)),
              loser_feed_b_from: idByKey.get(keyFor("winners", 0, 1)),
            })
          )
          .select("id")
          .single();
        if (el0 || !rl0) throw el0;
        idByKey.set(keyFor("losers", 0, 0), rl0.id as string);

        const { data: rl1, error: el1 } = await supabase
          .from("tournament_round_matches")
          .insert(
            rowPayload(lb10, {
              feed_a_from: idByKey.get(keyFor("losers", 0, 0)),
              player_b_from_loser_of: idByKey.get(keyFor("winners", 1, 0)),
            })
          )
          .select("id")
          .single();
        if (el1 || !rl1) throw el1;
        idByKey.set(keyFor("losers", 1, 0), rl1.id as string);

        const { error: eg } = await supabase.from("tournament_round_matches").insert(
          rowPayload(gr, {
            feed_a_from: idByKey.get(keyFor("winners", 1, 0)),
            feed_b_from: idByKey.get(keyFor("losers", 1, 0)),
          })
        );
        if (eg) throw eg;
      }

      await loadTournaments();
      setSelectedTournamentId(tid);
      setSelectedBeyIds([]);
      window.alert("Tournament created.");
    } catch (err: unknown) {
      console.error(err);
      window.alert(err instanceof Error ? err.message : "Could not create tournament.");
    }
  };

  const propagateFromNode = async (
    tournamentId: string,
    completed: RoundMatchRow,
    winnerBeyId: string,
    loserBeyId: string | null
  ) => {
    const { data: all } = await supabase
      .from("tournament_round_matches")
      .select("*")
      .eq("tournament_id", tournamentId);

    const list = (all as RoundMatchRow[]) ?? [];

    for (const n of list) {
      const updates: Record<string, string | null> = {};
      if (n.feed_a_from === completed.id) {
        updates.beyblade_a_id = winnerBeyId;
        updates.player_a_id = ownerForBey(winnerBeyId);
      }
      if (n.feed_b_from === completed.id) {
        updates.beyblade_b_id = winnerBeyId;
        updates.player_b_id = ownerForBey(winnerBeyId);
      }
      if (n.loser_feed_a_from === completed.id && loserBeyId) {
        updates.beyblade_a_id = loserBeyId;
        updates.player_a_id = ownerForBey(loserBeyId);
      }
      if (n.loser_feed_b_from === completed.id && loserBeyId) {
        updates.beyblade_b_id = loserBeyId;
        updates.player_b_id = ownerForBey(loserBeyId);
      }
      if (n.player_b_from_loser_of === completed.id && loserBeyId) {
        updates.beyblade_b_id = loserBeyId;
        updates.player_b_id = ownerForBey(loserBeyId);
      }

      if (Object.keys(updates).length > 0) {
        await supabase.from("tournament_round_matches").update(updates).eq("id", n.id);
      }
    }

    await loadBracket(tournamentId);

    const { data: after } = await supabase
      .from("tournament_round_matches")
      .select("*")
      .eq("tournament_id", tournamentId);
    const rows = (after as RoundMatchRow[]) ?? [];
    // Only winners bracket round 0 can be a structural bye (one seed, one null). Later rounds
    // often have one slot filled and one null while waiting for the sibling match — not a bye.
    for (const n of rows) {
      if (n.winner_beyblade_id) continue;
      const isWinnersR0Bye =
        n.bracket_side === "winners" &&
        n.round_index === 0 &&
        ((n.beyblade_a_id && !n.beyblade_b_id) || (!n.beyblade_a_id && n.beyblade_b_id));
      if (!isWinnersR0Bye) continue;
      const soleBey = n.beyblade_a_id ?? n.beyblade_b_id;
      if (!soleBey) continue;
      const wp = ownerForBey(soleBey);
      await supabase
        .from("tournament_round_matches")
        .update({ winner_beyblade_id: soleBey, winner_player_id: wp })
        .eq("id", n.id);
      await propagateFromNode(tournamentId, { ...n, winner_beyblade_id: soleBey }, soleBey, null);
      return;
    }

    const stillOpen = rows.some((n) => n.beyblade_a_id && n.beyblade_b_id && !n.winner_beyblade_id);
    if (!stillOpen) {
      await supabase
        .from("tournaments")
        .update({ status: "completed", finished_at: new Date().toISOString() })
        .eq("id", tournamentId);
      await loadTournaments();
    }
  };

  propagateFromNodeRef.current = propagateFromNode;

  /** Log one bracket match (1 pt vs 0). `forcedSide` is used by batch log from a fresh DB snapshot. */
  const logBracketMatch = async (node: RoundMatchRow, forcedSide?: "a" | "b"): Promise<boolean> => {
    if (!node.beyblade_a_id || !node.beyblade_b_id) {
      window.alert("Both beys must be assigned before logging.");
      return false;
    }
    const oa = ownerForBey(node.beyblade_a_id);
    const ob = ownerForBey(node.beyblade_b_id);
    if (!oa || !ob) {
      window.alert("Missing owner for one of the beys (inventory link).");
      return false;
    }
    const side = forcedSide ?? draftWinnerSide[node.id];
    if (side !== "a" && side !== "b") {
      window.alert("Select the winning bey.");
      return false;
    }
    const winnerOwner = side === "a" ? oa : ob;
    const winnerBey = side === "a" ? node.beyblade_a_id! : node.beyblade_b_id!;
    const loserBey = side === "a" ? node.beyblade_b_id! : node.beyblade_a_id!;
    const sa = side === "a" ? 1 : 0;
    const sb = side === "b" ? 1 : 0;

    try {
      const { data: matchRow, error: me } = await supabase
        .from("matches")
        .insert({
          format: "tournament",
          winner_player_id: winnerOwner,
          played_at: new Date().toISOString(),
          notes: `Tournament: ${beyName(node.beyblade_a_id)} vs ${beyName(node.beyblade_b_id)}`,
        })
        .select("id")
        .single();
      if (me || !matchRow) {
        window.alert(me?.message ?? "Failed to create match");
        return false;
      }
      const mid = matchRow.id as string;

      const { error: pe } = await supabase.from("match_participants").insert([
        {
          match_id: mid,
          player_id: oa,
          beyblade_id: node.beyblade_a_id,
          score: sa,
          is_winner: winnerBey === node.beyblade_a_id,
        },
        {
          match_id: mid,
          player_id: ob,
          beyblade_id: node.beyblade_b_id,
          score: sb,
          is_winner: winnerBey === node.beyblade_b_id,
        },
      ]);
      if (pe) {
        window.alert(pe.message);
        return false;
      }

      await supabase
        .from("tournament_round_matches")
        .update({
          winner_beyblade_id: winnerBey,
          winner_player_id: winnerOwner,
          match_id: mid,
        })
        .eq("id", node.id);

      await propagateFromNode(node.tournament_id, { ...node, winner_beyblade_id: winnerBey }, winnerBey, loserBey);

      setDraftWinnerSide((s) => {
        const next = { ...s };
        delete next[node.id];
        return next;
      });
      return true;
    } catch (err) {
      console.error(err);
      window.alert(err instanceof Error ? err.message : "Could not log match.");
      return false;
    }
  };

  const batchLogSelectedMatches = async () => {
    if (!selectedTournamentId || !isSupabaseConfigured) return;
    const drafts: Record<string, "a" | "b"> = { ...draftWinnerSide };
    const initialPicks = Object.keys(drafts).length;
    if (initialPicks === 0) {
      window.alert("Select a winner (radio) on each match you want to log, then try again.");
      return;
    }
    setBatchLogBusy(true);
    let logged = 0;
    try {
      for (let iter = 0; iter < 256; iter++) {
        const { data, error } = await supabase
          .from("tournament_round_matches")
          .select("*")
          .eq("tournament_id", selectedTournamentId);
        if (error) throw error;
        const rows = (data as RoundMatchRow[]) ?? [];
        const candidates = rows
          .filter(
            (n) =>
              n.beyblade_a_id &&
              n.beyblade_b_id &&
              !n.winner_beyblade_id &&
              (drafts[n.id] === "a" || drafts[n.id] === "b")
          )
          .sort(bracketBatchSortOrder);
        if (candidates.length === 0) break;
        const node = candidates[0]!;
        const side = drafts[node.id]!;
        const ok = await logBracketMatch(node, side);
        if (!ok) return;
        delete drafts[node.id];
        logged++;
      }
      await loadBracket(selectedTournamentId);
      const stillWaiting = Object.keys(drafts).length;
      window.alert(
        stillWaiting > 0
          ? `Logged ${logged} match(es). ${stillWaiting} winner pick(s) still waiting (complete earlier rounds first, or those slots are not ready yet).`
          : `Logged ${logged} match(es).`
      );
    } catch (err) {
      console.error(err);
      window.alert(err instanceof Error ? err.message : "Batch log failed.");
    } finally {
      setBatchLogBusy(false);
    }
  };

  const winnersByRound = useMemo(() => {
    const w = nodes.filter((n) => n.bracket_side === "winners");
    const maxR = w.reduce((m, n) => Math.max(m, n.round_index), 0);
    const cols: RoundMatchRow[][] = [];
    for (let r = 0; r <= maxR; r++) {
      cols.push(w.filter((n) => n.round_index === r).sort((a, b) => a.match_index - b.match_index));
    }
    return cols;
  }, [nodes]);

  /** Row tracks for winners grid: 2^maxRound so each match spans rows and centers between its feeders. */
  const winnersGridRowCount = useMemo(() => {
    const w = nodes.filter((n) => n.bracket_side === "winners");
    if (w.length === 0) return 1;
    const maxR = w.reduce((m, n) => Math.max(m, n.round_index), 0);
    return 2 ** maxR;
  }, [nodes]);

  const nonWinnersGrouped = useMemo(() => {
    const g: Record<string, RoundMatchRow[]> = {};
    for (const n of nodes) {
      if (n.bracket_side === "winners") continue;
      const k = `${n.bracket_side}-R${n.round_index}`;
      if (!g[k]) g[k] = [];
      g[k].push(n);
    }
    const sideOrder = (s: string) => (s.startsWith("losers") ? 0 : 1);
    return Object.entries(g).sort(([a], [b]) => {
      const [sa, ra] = a.split("-R");
      const [sb, rb] = b.split("-R");
      const o = sideOrder(sa) - sideOrder(sb);
      if (o !== 0) return o;
      return (Number(ra) || 0) - (Number(rb) || 0);
    });
  }, [nodes]);

  const canBatchLog = useMemo(() => {
    if (!selectedTournamentId) return false;
    return nodes.some(
      (n) =>
        n.beyblade_a_id &&
        n.beyblade_b_id &&
        !n.winner_beyblade_id &&
        (draftWinnerSide[n.id] === "a" || draftWinnerSide[n.id] === "b")
    );
  }, [nodes, draftWinnerSide, selectedTournamentId]);

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="pt-24 px-4">
          <p className="text-muted-foreground">Configure Supabase to use tournaments.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-24 pb-16 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-3xl font-bold text-foreground flex items-center gap-2">
                <Trophy className="w-8 h-8 text-primary" />
                Bey Tournament
              </h1>
              <p className="text-muted-foreground mt-1 max-w-2xl">
                Bracket is <strong className="text-foreground">bey vs bey</strong> only. Only beys in a blader&apos;s
                inventory appear below. The <strong className="text-foreground">bracket diagram</strong> is the
                horizontal rounds under Winners; losers + grand show below for double elim.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => selectedTournamentId && loadBracket(selectedTournamentId)}>
              <RefreshCw className="w-4 h-4 mr-1" />
              Refresh
            </Button>
          </div>

          {error && <div className="mb-4 p-4 rounded-lg bg-destructive/20 text-sm">{error}</div>}

          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            <>
              <section className="rounded-xl border border-border bg-card p-6 mb-8">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h2 className="font-display text-lg font-semibold">Create tournament</h2>
                  {selectedTournamentId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-muted-foreground"
                      onClick={() => setCreatePanelCollapsed((c) => !c)}
                    >
                      {createPanelCollapsed ? (
                        <>
                          Expand <ChevronDown className="inline w-4 h-4 ml-1" />
                        </>
                      ) : (
                        <>
                          Collapse <ChevronUp className="inline w-4 h-4 ml-1" />
                        </>
                      )}
                    </Button>
                  )}
                </div>
                {(!selectedTournamentId || !createPanelCollapsed) && (
                <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-xs text-muted-foreground">Name</label>
                    <input
                      className="mt-1 w-full h-10 rounded-lg bg-secondary border border-border px-3 text-sm"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Elimination</label>
                    <select
                      className="mt-1 w-full h-10 rounded-lg bg-secondary border border-border px-3 text-sm"
                      value={elimType}
                      onChange={(e) => setElimType(e.target.value as "single" | "double")}
                    >
                      <option value="single">Single elimination</option>
                      <option value="double">Double elimination (4 beys only)</option>
                    </select>
                  </div>
                </div>
                <div className="mt-3 rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground space-y-1.5">
                  <p className="font-medium text-foreground">How many beys?</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>
                      <strong className="text-foreground">Single elimination:</strong> any roster from the shared
                      inventory — pick <strong>at least 2</strong> beys (often <strong>all inventory</strong> via the
                      button below). The bracket always uses the <strong>next power of 2</strong> <em>slots</em> (2, 4,
                      8, 16, 32, …). Fewer beys than that → <strong>byes</strong> fill empty seeds. Example: 5 beys →
                      8-slot bracket (3 byes).
                    </li>
                    <li>
                      <strong className="text-foreground">Double elimination:</strong> exactly{" "}
                      <strong>{DOUBLE_ELIM_BEY_COUNT} beys</strong> — fixed mini-bracket, not for the full inventory.
                      Use single elimination for every bey.
                    </li>
                  </ul>
                </div>
                <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-border p-2 flex flex-wrap gap-1.5">
                  {inventoryBeys.length === 0 ? (
                    <p className="text-xs text-muted-foreground w-full py-2">
                      No beys in any blader inventory yet. Add beys in Inventory first.
                    </p>
                  ) : (
                    inventoryBeys.map((b) => {
                      const sel = selectedBeyIds.includes(b.id);
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => toggleBey(b.id)}
                          className={`px-2 py-1 rounded text-xs border max-w-[200px] truncate ${
                            sel
                              ? "bg-primary/20 border-primary text-foreground"
                              : "bg-secondary border-border text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          {b.name}
                        </button>
                      );
                    })
                  )}
                </div>
                <div className="mt-3 space-y-2">
                  <p className="text-xs font-medium text-foreground">Auto-select beys</p>
                  <div className="flex flex-wrap gap-2">
                    {elimType === "single" ? (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={inventoryBeys.length < 2}
                          onClick={() => setSelectedBeyIds(inventoryBeys.map((b) => b.id))}
                        >
                          Select entire inventory
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={inventoryBeys.length < 2}
                          onClick={() =>
                            setSelectedBeyIds(pickRandomDistinctBeyIds(inventoryBeys, inventoryBeys.length))
                          }
                        >
                          Random full roster
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={inventoryBeys.length < 4}
                          onClick={() => setSelectedBeyIds(pickRandomDistinctBeyIds(inventoryBeys, 4))}
                        >
                          Random 4
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={inventoryBeys.length < 8}
                          onClick={() => setSelectedBeyIds(pickRandomDistinctBeyIds(inventoryBeys, 8))}
                        >
                          Random 8
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={inventoryBeys.length < 16}
                          onClick={() => setSelectedBeyIds(pickRandomDistinctBeyIds(inventoryBeys, 16))}
                        >
                          Random 16
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={inventoryBeys.length < DOUBLE_ELIM_BEY_COUNT}
                        onClick={() => setSelectedBeyIds(pickRandomDistinctBeyIds(inventoryBeys, DOUBLE_ELIM_BEY_COUNT))}
                      >
                        Random {DOUBLE_ELIM_BEY_COUNT} (double elim)
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 items-center">
                  <span className="text-xs text-muted-foreground">
                    Selected: {selectedBeyIds.length}
                    {elimType === "single" ? (
                      <>
                        {" "}
                        {selectedBeyIds.length < 2 ? (
                          <>→ pick at least 2 beys</>
                        ) : (
                          <>
                            {" "}
                            → {selectedBeyIds.length} entrants, bracket {nextPow2(Math.max(2, selectedBeyIds.length))}{" "}
                            slots (
                            {nextPow2(Math.max(2, selectedBeyIds.length)) - selectedBeyIds.length} bye
                            {nextPow2(Math.max(2, selectedBeyIds.length)) - selectedBeyIds.length === 1 ? "" : "s"})
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        {" "}
                        {selectedBeyIds.length === DOUBLE_ELIM_BEY_COUNT ? (
                          <>→ 6 matches (WB + LB + grand)</>
                        ) : (
                          <>→ need exactly {DOUBLE_ELIM_BEY_COUNT} beys</>
                        )}
                      </>
                    )}
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setSelectedBeyIds(shuffleInPlace(selectedBeyIds))}>
                    <Shuffle className="w-4 h-4 mr-1" />
                    Shuffle order
                  </Button>
                </div>
                {largeCreateBracketPreview && (
                  <p className="mt-2 text-xs text-amber-800 dark:text-amber-200/90">
                    Large bracket preview: {largeCreateBracketPreview.n} entrants → {largeCreateBracketPreview.P} slots (
                    {largeCreateBracketPreview.byes} bye{largeCreateBracketPreview.byes === 1 ? "" : "s"}). You will be
                    asked to confirm when you create.
                  </p>
                )}
                <Button className="mt-4" onClick={createTournament}>
                  Create &amp; open bracket
                </Button>
                </>
                )}
              </section>

              <section className="rounded-xl border border-border bg-card p-6 mb-8">
                <h2 className="font-display text-lg font-semibold mb-2">Saved tournaments</h2>
                <select
                  className="w-full max-w-md h-10 rounded-lg bg-secondary border border-border px-3 text-sm"
                  value={selectedTournamentId}
                  onChange={(e) => setSelectedTournamentId(e.target.value)}
                >
                  <option value="">— Select —</option>
                  {tournaments.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.elimination_type}, {t.status})
                    </option>
                  ))}
                </select>
              </section>

              {selectedTournamentId && (
                <section className="space-y-10">
                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                      <h3 className="font-display text-lg font-semibold text-primary">Bracket (winners)</h3>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="shrink-0"
                        disabled={batchLogBusy || !canBatchLog}
                        onClick={() => void batchLogSelectedMatches()}
                      >
                        {batchLogBusy ? "Logging…" : "Log all selected"}
                      </Button>
                    </div>
                    {singleElimBracketSummary && (
                      <p className="text-xs text-muted-foreground mb-2">
                        {singleElimBracketSummary.entrantCount} entrants · {singleElimBracketSummary.slots} bracket slots ·{" "}
                        {singleElimBracketSummary.byes} bye{singleElimBracketSummary.byes === 1 ? "" : "s"}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mb-2">
                      Each column is a round; each match sits midway between the two matches it receives from the
                      previous round (horizontal stubs + column dividers show flow). Pick winners for this round, then use{" "}
                      <strong className="text-foreground">Log all selected</strong> to record every ready match in order
                      (repeat after each round if you like).
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">
                      Tournament 1-pt wins count toward <strong className="text-foreground">bey</strong> stats on{" "}
                      <strong className="text-foreground">Reports</strong> and <strong className="text-foreground">Inventory</strong>{" "}
                      (league / blader totals there exclude tournaments).
                    </p>
                    <div className="flex flex-row gap-0 overflow-x-auto pb-6 pt-2 items-stretch">
                      {winnersByRound.map((col, ri) => (
                        <div
                          key={ri}
                          className={`flex flex-col shrink-0 min-w-[168px] md:min-w-[184px] ${
                            ri > 0 ? "pl-4 md:pl-7 border-l border-border/70" : ""
                          }`}
                        >
                          <div className="text-center text-xs font-display text-muted-foreground mb-3 pb-1 border-b border-border">
                            Round {ri + 1}
                          </div>
                          <div
                            className="grid w-full flex-1 relative"
                            style={{
                              gridTemplateRows: `repeat(${winnersGridRowCount}, minmax(0, 1fr))`,
                              minHeight: `${Math.max(200, winnersGridRowCount * 40)}px`,
                            }}
                          >
                            {col.map((node) => {
                              const rowSpan = 2 ** ri;
                              const rowStart = node.match_index * rowSpan + 1;
                              const hideRound0Structural =
                                ri === 0 &&
                                !node.beyblade_a_id &&
                                !node.beyblade_b_id &&
                                !node.winner_beyblade_id;
                              if (hideRound0Structural) {
                                return (
                                  <div
                                    key={node.id}
                                    style={{ gridRow: `${rowStart} / span ${rowSpan}` }}
                                    className="min-h-0 flex items-center opacity-0 pointer-events-none select-none"
                                    aria-hidden
                                  >
                                    <div className="h-px w-full" />
                                  </div>
                                );
                              }

                              const canPlay =
                                node.beyblade_a_id && node.beyblade_b_id && !node.winner_beyblade_id;
                              const done = !!node.winner_beyblade_id;
                              const emptySlot =
                                !node.beyblade_a_id && !node.beyblade_b_id && !node.winner_beyblade_id;
                              const waitingForOpponent =
                                !done &&
                                ((node.beyblade_a_id && !node.beyblade_b_id) ||
                                  (!node.beyblade_a_id && node.beyblade_b_id));
                              const byeLine =
                                node.bracket_side === "winners" && node.round_index === 0
                                  ? "Bye — advancing…"
                                  : "Waiting for opponent…";

                              return (
                                <div
                                  key={node.id}
                                  style={{ gridRow: `${rowStart} / span ${rowSpan}` }}
                                  className="relative flex items-center min-h-0 py-1"
                                >
                                  {ri > 0 && (
                                    <div
                                      className="pointer-events-none absolute top-1/2 -translate-y-1/2 h-px bg-border/90 z-0"
                                      style={{
                                        left: 0,
                                        width: "1.35rem",
                                        marginLeft: "-1.35rem",
                                      }}
                                      aria-hidden
                                    />
                                  )}
                                  <div
                                    id={`match-${node.id}`}
                                    className={`relative z-[1] w-full rounded-lg border text-sm p-2 ${
                                      done ? "border-border bg-secondary/20" : "border-primary/50 bg-card"
                                    }`}
                                  >
                                    {emptySlot ? (
                                      <div className="text-[10px] text-muted-foreground text-center py-2">Pending</div>
                                    ) : canPlay ? (
                                      <>
                                        <p className="text-[10px] text-muted-foreground mb-1.5">Winner gets 1 pt</p>
                                        <label className="flex items-center gap-2 cursor-pointer min-w-0 py-0.5">
                                          <input
                                            type="radio"
                                            name={`tw-${node.id}`}
                                            checked={draftWinnerSide[node.id] === "a"}
                                            onChange={() =>
                                              setDraftWinnerSide((s) => ({ ...s, [node.id]: "a" }))
                                            }
                                            className="h-4 w-4 accent-primary shrink-0"
                                          />
                                          <span className="font-medium text-foreground truncate text-xs flex-1 min-w-0">
                                            {beyName(node.beyblade_a_id)}
                                          </span>
                                        </label>
                                        <div className="text-center text-[10px] text-muted-foreground py-0.5">vs</div>
                                        <label className="flex items-center gap-2 cursor-pointer min-w-0 py-0.5">
                                          <input
                                            type="radio"
                                            name={`tw-${node.id}`}
                                            checked={draftWinnerSide[node.id] === "b"}
                                            onChange={() =>
                                              setDraftWinnerSide((s) => ({ ...s, [node.id]: "b" }))
                                            }
                                            className="h-4 w-4 accent-primary shrink-0"
                                          />
                                          <span className="font-medium text-foreground truncate text-xs flex-1 min-w-0">
                                            {beyName(node.beyblade_b_id)}
                                          </span>
                                        </label>
                                        <Button
                                          type="button"
                                          size="sm"
                                          className="w-full h-8 mt-1.5 text-xs"
                                          onClick={() => void logBracketMatch(node)}
                                        >
                                          Log result
                                        </Button>
                                      </>
                                    ) : (
                                      <>
                                        <div className="font-medium text-foreground leading-tight text-xs">
                                          {beyName(node.beyblade_a_id)}
                                        </div>
                                        <div className="text-center text-[10px] text-muted-foreground py-0.5">vs</div>
                                        <div className="font-medium text-foreground leading-tight text-xs">
                                          {beyName(node.beyblade_b_id)}
                                        </div>
                                        {waitingForOpponent && (
                                          <p className="text-[10px] text-muted-foreground mt-1">{byeLine}</p>
                                        )}
                                      </>
                                    )}
                                    {done && (
                                      <div className="mt-1.5 text-xs text-primary font-medium">
                                        Winner: {beyName(node.winner_beyblade_id)}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {nonWinnersGrouped.length > 0 && (
                    <div>
                      <h3 className="font-display text-lg font-semibold text-accent mb-3">Losers / Grand final</h3>
                      <div className="space-y-6">
                        {nonWinnersGrouped.map(([label, matches]) => (
                          <div key={label}>
                            <h4 className="text-xs font-semibold text-muted-foreground mb-2">{label}</h4>
                            <div className="grid gap-4 sm:grid-cols-2">
                              {matches.map((node) => {
                                const canPlay =
                                  node.beyblade_a_id && node.beyblade_b_id && !node.winner_beyblade_id;
                                const done = !!node.winner_beyblade_id;
                                const emptySlot =
                                  !node.beyblade_a_id && !node.beyblade_b_id && !node.winner_beyblade_id;
                                return (
                                  <div
                                    key={node.id}
                                    id={`match-${node.id}`}
                                    className={`rounded-lg border p-3 text-sm ${done ? "border-border" : "border-primary/40"}`}
                                  >
                                    {emptySlot ? (
                                      <div className="text-[10px] text-muted-foreground text-center py-1">Pending</div>
                                    ) : canPlay ? (
                                      <>
                                        <p className="text-[10px] text-muted-foreground mb-1.5">Winner gets 1 pt</p>
                                        <label className="flex items-center gap-2 cursor-pointer min-w-0 py-0.5">
                                          <input
                                            type="radio"
                                            name={`tw-${node.id}`}
                                            checked={draftWinnerSide[node.id] === "a"}
                                            onChange={() =>
                                              setDraftWinnerSide((s) => ({ ...s, [node.id]: "a" }))
                                            }
                                            className="h-4 w-4 accent-primary shrink-0"
                                          />
                                          <span className="font-medium truncate text-xs flex-1 min-w-0">
                                            {beyName(node.beyblade_a_id)}
                                          </span>
                                        </label>
                                        <div className="text-center text-[10px] text-muted-foreground py-0.5">vs</div>
                                        <label className="flex items-center gap-2 cursor-pointer min-w-0 py-0.5">
                                          <input
                                            type="radio"
                                            name={`tw-${node.id}`}
                                            checked={draftWinnerSide[node.id] === "b"}
                                            onChange={() =>
                                              setDraftWinnerSide((s) => ({ ...s, [node.id]: "b" }))
                                            }
                                            className="h-4 w-4 accent-primary shrink-0"
                                          />
                                          <span className="font-medium truncate text-xs flex-1 min-w-0">
                                            {beyName(node.beyblade_b_id)}
                                          </span>
                                        </label>
                                        <Button
                                          type="button"
                                          size="sm"
                                          className="w-full h-8 mt-1.5 text-xs"
                                          onClick={() => void logBracketMatch(node)}
                                        >
                                          Log result
                                        </Button>
                                      </>
                                    ) : (
                                      <div className="text-xs font-medium">
                                        {beyName(node.beyblade_a_id)} vs {beyName(node.beyblade_b_id)}
                                      </div>
                                    )}
                                    {done && (
                                      <p className="text-xs text-primary mt-1">Winner: {beyName(node.winner_beyblade_id)}</p>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
