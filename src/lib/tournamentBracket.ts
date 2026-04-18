/**
 * Bracket structure for single elimination (power-of-2, any count ≥2 with byes) and
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

export function keyFor(side: BracketSide, round: number, match: number): string {
  return `${side}-${round}-${match}`;
}

/** Single-elim winners bracket seeded with beyblade ids (null = bye). */
export function buildSingleEliminationPlans(beybladeIds: string[]): RoundMatchInsertPlan[] {
  const n = Math.max(2, beybladeIds.length);
  const P = nextPow2(n);
  const seeds: (string | null)[] = [...beybladeIds];
  while (seeds.length < P) seeds.push(null);

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
