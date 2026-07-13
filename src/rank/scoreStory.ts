import type { CandidateStory, RankedStory, StoryScores } from "../types";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function scoreStory(story: CandidateStory): { finalScore: number; scoreBreakdown: StoryScores & { final_score: number } } {
  const s: StoryScores = {
    freshness: clamp01(story.scores.freshness),
    trend_velocity: clamp01(story.scores.trend_velocity),
    aimh_audience_fit: clamp01(story.scores.aimh_audience_fit),
    credibility: clamp01(story.scores.credibility),
    demoability: clamp01(story.scores.demoability),
    novelty: clamp01(story.scores.novelty),
    risk_or_noise: clamp01(story.scores.risk_or_noise),
    duplicate_coverage_penalty: clamp01(story.scores.duplicate_coverage_penalty)
  };
  const finalScore =
    0.25 * s.freshness +
    0.2 * s.trend_velocity +
    0.2 * s.aimh_audience_fit +
    0.15 * s.credibility +
    0.1 * s.demoability +
    0.1 * s.novelty -
    0.25 * s.risk_or_noise -
    0.1 * s.duplicate_coverage_penalty;

  return {
    finalScore,
    scoreBreakdown: {
      ...s,
      final_score: finalScore
    }
  };
}

export function rankStories(stories: CandidateStory[]): RankedStory[] {
  return stories
    .map((story) => {
      const scored = scoreStory(story);
      return { ...story, ...scored };
    })
    .sort((a, b) => b.finalScore - a.finalScore);
}
