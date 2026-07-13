import { describe, expect, it } from "vitest";
import { rankStories, scoreStory } from "../src/rank/scoreStory";
import type { CandidateStory } from "../src/types";

const story = (overrides: Partial<CandidateStory>): CandidateStory => ({
  id: "story_base",
  title: "Base AI story",
  summary: "A useful AI update.",
  sourceIds: ["source_001"],
  claimIds: ["claim_001"],
  sourceTypes: ["official"],
  scores: {
    freshness: 0.8,
    trend_velocity: 0.5,
    aimh_audience_fit: 0.8,
    credibility: 0.9,
    demoability: 0.6,
    novelty: 0.5,
    risk_or_noise: 0.1,
    duplicate_coverage_penalty: 0.1
  },
  ...overrides
});

describe("story ranking", () => {
  it("uses the handoff scoring formula", () => {
    const result = scoreStory(story({}));
    expect(result.finalScore).toBeCloseTo(0.67, 5);
  });

  it("ranks credible AIMH-fit stories above noisy duplicates", () => {
    const ranked = rankStories([
      story({
        id: "noisy",
        title: "Unverified viral rumor",
        sourceTypes: ["social"],
        scores: {
          freshness: 1,
          trend_velocity: 1,
          aimh_audience_fit: 0.4,
          credibility: 0.1,
          demoability: 0.4,
          novelty: 0.4,
          risk_or_noise: 0.9,
          duplicate_coverage_penalty: 0.7
        }
      }),
      story({ id: "official", title: "Official developer launch" })
    ]);

    expect(ranked[0]?.id).toBe("official");
    expect(ranked[0]?.scoreBreakdown.final_score).toBeGreaterThan(ranked[1]!.scoreBreakdown.final_score);
  });
});
