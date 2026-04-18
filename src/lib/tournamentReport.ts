/**
 * Bey-centric tournament analytics from bracket rows (single-elim winners bracket).
 * Bladers are intentionally ignored — owners may not match who piloted the bey.
 */

export type TournamentRoundMatchRow = {
  tournament_id: string;
  bracket_side: "winners" | "losers" | "grand";
  round_index: number;
  match_index: number;
  beyblade_a_id: string | null;
  beyblade_b_id: string | null;
  winner_beyblade_id: string | null;
};

export type TournamentMeta = {
  id: string;
  elimination_type: "single" | "double";
};

/** Lower = better. Champion = 1, finalist = 2, semis band = 4, etc. */
export function eliminationBandRank(maxRound: number, lossRound: number): number {
  if (lossRound > maxRound) return 999;
  if (lossRound === maxRound) return 2;
  return 2 ** (maxRound - lossRound + 1);
}

export function finishLabel(maxRound: number, lossRound: number | null, isChampion: boolean): string {
  if (isChampion) return "Champion";
  if (lossRound === null) return "—";
  if (lossRound === maxRound) return "Finalist";
  const topN = 2 ** (maxRound - lossRound + 1);
  return `Top ${topN}`;
}

/**
 * Per bey, per single-elim tournament: band rank (for min) and label.
 * Incomplete finals: no champion; still records losses from resolved matches.
 */
export function singleElimBeyFinishInTournament(
  beyId: string,
  nodes: TournamentRoundMatchRow[],
  maxRound: number,
  finalNode: TournamentRoundMatchRow | undefined
): { rank: number; label: string } {
  if (!nodes.length) return { rank: 999, label: "—" };

  const inBracket = nodes.some(
    (n) => n.beyblade_a_id === beyId || n.beyblade_b_id === beyId || n.winner_beyblade_id === beyId
  );
  if (!inBracket) return { rank: 999, label: "—" };

  if (finalNode?.winner_beyblade_id === beyId) {
    return { rank: 1, label: "Champion" };
  }

  const losses = nodes.filter(
    (n) =>
      n.winner_beyblade_id &&
      n.winner_beyblade_id !== beyId &&
      (n.beyblade_a_id === beyId || n.beyblade_b_id === beyId)
  );
  if (losses.length === 0) {
    return { rank: 999, label: "In progress" };
  }

  if (losses.some((n) => n.round_index === maxRound)) {
    return { rank: 2, label: "Finalist" };
  }

  const deepest = losses.reduce((a, b) => (b.round_index > a.round_index ? b : a));
  const lr = deepest.round_index;
  const rank = eliminationBandRank(maxRound, lr);
  const label = finishLabel(maxRound, lr, false);
  return { rank, label };
}

/** Aggregate titles, best finish, entry count across tournaments. */
export function aggregateTournamentBeyCareer(
  tournaments: TournamentMeta[],
  roundMatches: TournamentRoundMatchRow[],
  entries: { tournament_id: string; beyblade_id: string | null }[]
): Record<
  string,
  { titles: number; bestRank: number; bestLabel: string; tournamentsEntered: number }
> {
  const out: Record<string, { titles: number; bestRank: number; bestLabel: string; tournamentsEntered: number }> = {};

  const byTid = new Map<string, TournamentRoundMatchRow[]>();
  for (const n of roundMatches) {
    if (n.bracket_side !== "winners") continue;
    const list = byTid.get(n.tournament_id) ?? [];
    list.push(n);
    byTid.set(n.tournament_id, list);
  }

  const singles = new Set(tournaments.filter((t) => t.elimination_type === "single").map((t) => t.id));

  const beysByTournament = new Map<string, Set<string>>();
  for (const e of entries) {
    if (!e.beyblade_id) continue;
    if (!beysByTournament.has(e.tournament_id)) beysByTournament.set(e.tournament_id, new Set());
    beysByTournament.get(e.tournament_id)!.add(e.beyblade_id);
  }

  for (const tid of singles) {
    const nodes = byTid.get(tid) ?? [];
    if (!nodes.length) continue;

    const maxRound = nodes.reduce((m, n) => Math.max(m, n.round_index), 0);
    const finals = nodes.filter((n) => n.round_index === maxRound);
    const finalNode = finals.sort((a, b) => a.match_index - b.match_index)[0];

    const beys = beysByTournament.get(tid);
    if (!beys) continue;

    for (const beyId of beys) {
      const { rank, label } = singleElimBeyFinishInTournament(beyId, nodes, maxRound, finalNode);
      if (!out[beyId]) {
        out[beyId] = { titles: 0, bestRank: 999, bestLabel: "—", tournamentsEntered: 0 };
      }
      const o = out[beyId]!;
      o.tournamentsEntered++;
      if (rank === 1) o.titles++;
      if (rank < o.bestRank) {
        o.bestRank = rank;
        o.bestLabel = label;
      }
    }
  }

  return out;
}
