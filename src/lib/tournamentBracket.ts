/**
 * Bracket structure for single elimination (power-of-2 slots, any count ≥2 with byes / play-ins) and
 * double elimination (fixed 4-bey layout).
 * Slots are beys (catalog ids), not bladers.
 */

export type BracketSide = "winners" | "losers" | "grand";

export type RoundMatchInsertPlan = {
  bracket_side: BracketSide;
  round_index: number;
  match_index: number;
  beyblade_a_id: string | null;
  beyblade_b_id: string | null;
};

export function nextPow2(n: number): number {
  if (n <= 1) return 2;
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

/**
 * Round-0 matches where two real entrants play (minimal layout).
 * For N=17 and P=32 → 1 play-in; the other 15 first-round pairings are one entrant vs bye.
 */
export function singleElimFirstRoundPlayableCount(beyCount: number): number {
  const n = Math.max(2, beyCount);
  const P = nextPow2(n);
  return n - P / 2;
}

export function keyFor(side: BracketSide, round: number, match: number): string {
  return `${side}-${round}-${match}`;
}

/**
 * Spread entrants across P leaf slots so round 0 has as few real games as possible:
 * exactly `n - P/2` pairings with two teams; the rest are one team + bye (no null-null clutter).
 * Play-in pairs use the lowest indices (top of the Round 1 column); then bye-only pairings.
 */
export function buildSingleEliminationSeedSlots(beybladeIds: string[], P: number): (string | null)[] {
  const n = beybladeIds.length;
  const numPairs = P / 2;
  const playInPairCount = n - numPairs;
  const seeds = new Array<string | null>(P).fill(null);
  let t = 0;
  for (let pi = 0; pi < playInPairCount; pi++) {
    seeds[2 * pi] = beybladeIds[t++] ?? null;
    seeds[2 * pi + 1] = beybladeIds[t++] ?? null;
  }
  for (let pi = playInPairCount; pi < numPairs; pi++) {
    seeds[2 * pi] = beybladeIds[t++] ?? null;
    seeds[2 * pi + 1] = null;
  }
  return seeds;
}

/** Single-elim winners bracket seeded with beyblade ids (null = bye). */
export function buildSingleEliminationPlans(beybladeIds: string[]): RoundMatchInsertPlan[] {
  const n = Math.max(2, beybladeIds.length);
  const P = nextPow2(n);
  const seeds = buildSingleEliminationSeedSlots(beybladeIds, P);

  const rounds = Math.log2(P);
  const plans: RoundMatchInsertPlan[] = [];

  for (let r = 0; r < rounds; r++) {
    const matchesInRound = P / 2 ** (r + 1);
    for (let i = 0; i < matchesInRound; i++) {
      if (r === 0) {
        plans.push({
          bracket_side: "winners",
          round_index: r,
          match_index: i,
          beyblade_a_id: seeds[2 * i] ?? null,
          beyblade_b_id: seeds[2 * i + 1] ?? null,
        });
      } else {
        plans.push({
          bracket_side: "winners",
          round_index: r,
          match_index: i,
          beyblade_a_id: null,
          beyblade_b_id: null,
        });
      }
    }
  }
  return plans;
}

/** Double elimination for exactly 4 beys. */
export function buildDoubleEliminationFourPlans(beybladeIds: string[]): RoundMatchInsertPlan[] {
  if (beybladeIds.length !== 4) {
    throw new Error("Double elimination (4-bey layout) requires exactly 4 beys.");
  }
  const [a, b, c, d] = beybladeIds;
  return [
    { bracket_side: "winners" as const, round_index: 0, match_index: 0, beyblade_a_id: a, beyblade_b_id: b },
    { bracket_side: "winners" as const, round_index: 0, match_index: 1, beyblade_a_id: c, beyblade_b_id: d },
    { bracket_side: "winners" as const, round_index: 1, match_index: 0, beyblade_a_id: null, beyblade_b_id: null },
    { bracket_side: "losers" as const, round_index: 0, match_index: 0, beyblade_a_id: null, beyblade_b_id: null },
    { bracket_side: "losers" as const, round_index: 1, match_index: 0, beyblade_a_id: null, beyblade_b_id: null },
    { bracket_side: "grand" as const, round_index: 0, match_index: 0, beyblade_a_id: null, beyblade_b_id: null },
  ];
}
