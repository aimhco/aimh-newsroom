import type { RawItem } from "../types";

export function fixtureRawItems(): RawItem[] {
  return [
    {
      id: "raw_openai_developer_update",
      title: "OpenAI developer update leads today's fixture briefing",
      url: "https://openai.com/news/",
      publisher: "OpenAI",
      source_type: "official",
      published_at: "2026-07-08T12:00:00-04:00",
      summary: "OpenAI's official news page is used as the canonical proof source for the main fixture story.",
      tags: ["openai", "developer"],
      scores: {
        freshness: 0.9,
        trend_velocity: 0.65,
        aimh_audience_fit: 0.95,
        credibility: 1,
        demoability: 0.8,
        novelty: 0.65,
        risk_or_noise: 0.05,
        duplicate_coverage_penalty: 0.15
      }
    },
    {
      id: "raw_github_copilot_demo",
      title: "GitHub Copilot workflow is the practical demo fixture",
      url: "https://github.com/features/copilot",
      publisher: "GitHub",
      source_type: "official",
      published_at: "2026-07-08T10:00:00-04:00",
      summary: "The fixture pipeline treats GitHub Copilot's public product page as a safe browser-demo candidate.",
      tags: ["github", "demo"],
      scores: {
        freshness: 0.72,
        trend_velocity: 0.55,
        aimh_audience_fit: 0.9,
        credibility: 0.95,
        demoability: 0.95,
        novelty: 0.5,
        risk_or_noise: 0.05,
        duplicate_coverage_penalty: 0.2
      }
    },
    {
      id: "raw_huggingface_watch",
      title: "Hugging Face model page becomes the tool-to-watch fixture",
      url: "https://huggingface.co/models",
      publisher: "Hugging Face",
      source_type: "model",
      published_at: "2026-07-08T09:00:00-04:00",
      summary: "The model directory gives the dry run a visual model-card segment without requiring credentials.",
      tags: ["models", "hugging-face"],
      scores: {
        freshness: 0.68,
        trend_velocity: 0.6,
        aimh_audience_fit: 0.82,
        credibility: 0.85,
        demoability: 0.85,
        novelty: 0.7,
        risk_or_noise: 0.08,
        duplicate_coverage_penalty: 0.12
      }
    },
    {
      id: "raw_anthropic_quick_hit",
      title: "Anthropic docs provide a quick-hit source",
      url: "https://docs.anthropic.com/",
      publisher: "Anthropic",
      source_type: "official",
      published_at: "2026-07-08T08:00:00-04:00",
      summary: "Anthropic's documentation is included as a fixture quick hit for source-proof coverage.",
      tags: ["anthropic", "docs"],
      scores: {
        freshness: 0.6,
        trend_velocity: 0.35,
        aimh_audience_fit: 0.78,
        credibility: 0.95,
        demoability: 0.7,
        novelty: 0.45,
        risk_or_noise: 0.05,
        duplicate_coverage_penalty: 0.1
      }
    },
    {
      id: "raw_hn_social_noise",
      title: "Social discussion remains labeled as context only",
      url: "https://news.ycombinator.com/",
      publisher: "Hacker News",
      source_type: "social",
      published_at: "2026-07-08T07:30:00-04:00",
      summary: "This social/community fixture is useful for velocity context but not treated as canonical proof.",
      tags: ["community", "context"],
      scores: {
        freshness: 0.75,
        trend_velocity: 0.75,
        aimh_audience_fit: 0.55,
        credibility: 0.35,
        demoability: 0.45,
        novelty: 0.4,
        risk_or_noise: 0.35,
        duplicate_coverage_penalty: 0.25
      }
    }
  ];
}
