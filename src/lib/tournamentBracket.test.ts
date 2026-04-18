import { describe, expect, it } from "vitest";
import {
  buildSingleEliminationPlans,
  buildSingleEliminationSeedSlots,
  nextPow2,
  singleElimFirstRoundPlayableCount,
} from "./tournamentBracket";

describe("singleElimFirstRoundPlayableCount", () => {
  it("matches n - P/2", () => {
    expect(singleElimFirstRoundPlayableCount(17)).toBe(1);
    expect(singleElimFirstRoundPlayableCount(5)).toBe(1);
    expect(singleElimFirstRoundPlayableCount(9)).toBe(1);
    expect(singleElimFirstRoundPlayableCount(16)).toBe(8);
    expect(singleElimFirstRoundPlayableCount(2)).toBe(1);
  });
});

describe("buildSingleEliminationSeedSlots", () => {
  it("places exactly n ids and uses P slots", () => {
    const ids = Array.from({ length: 17 }, (_, i) => `b${i}`);
    const P = nextPow2(17);
    const seeds = buildSingleEliminationSeedSlots(ids, P);
    expect(seeds.length).toBe(32);
    expect(seeds.filter(Boolean).length).toBe(17);
  });
});

describe("buildSingleEliminationPlans round 0", () => {
  it("17 beys → one two-bey match and fifteen bye pairings, no empty-empty; play-in at match_index 0", () => {
    const ids = Array.from({ length: 17 }, (_, i) => `b${i}`);
    const r0 = buildSingleEliminationPlans(ids).filter((p) => p.round_index === 0);
    expect(r0.length).toBe(16);
    const twoBey = r0.filter((p) => p.beyblade_a_id && p.beyblade_b_id);
    const oneBey = r0.filter(
      (p) => (p.beyblade_a_id && !p.beyblade_b_id) || (!p.beyblade_a_id && p.beyblade_b_id)
    );
    const empty = r0.filter((p) => !p.beyblade_a_id && !p.beyblade_b_id);
    expect(twoBey.length).toBe(1);
    expect(twoBey[0]!.match_index).toBe(0);
    expect(oneBey.length).toBe(15);
    expect(empty.length).toBe(0);
  });

  it("5 beys → one play-in and three bye pairings", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const r0 = buildSingleEliminationPlans(ids).filter((p) => p.round_index === 0);
    expect(r0.length).toBe(4);
    expect(r0.filter((p) => p.beyblade_a_id && p.beyblade_b_id).length).toBe(1);
    expect(r0.filter((p) => !p.beyblade_a_id && !p.beyblade_b_id).length).toBe(0);
  });
});
