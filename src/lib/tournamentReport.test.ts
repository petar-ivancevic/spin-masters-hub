import { describe, expect, it } from "vitest";
import {
  aggregateTournamentBeyCareer,
  eliminationBandRank,
  singleElimBeyFinishInTournament,
} from "./tournamentReport";

describe("eliminationBandRank", () => {
  it("assigns worse ranks for earlier exits", () => {
    expect(eliminationBandRank(4, 3)).toBe(4);
    expect(eliminationBandRank(4, 2)).toBe(8);
    expect(eliminationBandRank(4, 0)).toBe(32);
  });
});

describe("singleElimBeyFinishInTournament", () => {
  it("marks champion from final winner", () => {
    const nodes = [
      {
        tournament_id: "t1",
        bracket_side: "winners" as const,
        round_index: 0,
        match_index: 0,
        beyblade_a_id: "a",
        beyblade_b_id: "b",
        winner_beyblade_id: "a",
      },
      {
        tournament_id: "t1",
        bracket_side: "winners" as const,
        round_index: 1,
        match_index: 0,
        beyblade_a_id: "a",
        beyblade_b_id: "c",
        winner_beyblade_id: "a",
      },
    ];
    const final = nodes[1];
    expect(singleElimBeyFinishInTournament("a", nodes, 1, final).label).toBe("Champion");
    expect(singleElimBeyFinishInTournament("c", nodes, 1, final).label).toBe("Finalist");
  });
});

describe("aggregateTournamentBeyCareer", () => {
  it("counts a title", () => {
    const tournaments = [{ id: "t1", elimination_type: "single" as const }];
    const roundMatches = [
      {
        tournament_id: "t1",
        bracket_side: "winners" as const,
        round_index: 0,
        match_index: 0,
        beyblade_a_id: "x",
        beyblade_b_id: "y",
        winner_beyblade_id: "x",
      },
      {
        tournament_id: "t1",
        bracket_side: "winners" as const,
        round_index: 1,
        match_index: 0,
        beyblade_a_id: "x",
        beyblade_b_id: "z",
        winner_beyblade_id: "x",
      },
    ];
    const entries = [
      { tournament_id: "t1", beyblade_id: "x" },
      { tournament_id: "t1", beyblade_id: "y" },
      { tournament_id: "t1", beyblade_id: "z" },
    ];
    const agg = aggregateTournamentBeyCareer(tournaments, roundMatches, entries);
    expect(agg.x?.titles).toBe(1);
    expect(agg.x?.bestLabel).toBe("Champion");
    expect(agg.y?.bestLabel).toBe("Top 4");
    expect(agg.z?.bestLabel).toBe("Finalist");
  });
});
