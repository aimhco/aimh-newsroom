import { describe, expect, it } from "vitest";
import { runPackageQa } from "../src/qa/qaRunner";
import type { EpisodePackage } from "../src/types";

const validPackage = (): EpisodePackage => ({
  episode: {
    schema_version: "0.1.0",
    episode_id: "2026-07-09-daily-ai-briefing",
    date: "2026-07-09",
    timezone: "America/New_York",
    title: "Today in AI",
    description: "Fixture briefing.",
    format: "daily_ai_briefing",
    target_duration_seconds: 240,
    status: "needs_review",
    segments: [],
    youtube: {},
    sources_file: "sources.json",
    script_file: "script.json",
    shotlist_file: "shotlist.json",
    metadata_file: "metadata.json"
  },
  script: {
    schema_version: "0.1.0",
    voice: {
      provider: "placeholder",
      voice_id_env: "ELEVENLABS_VOICE_ID",
      style: "clear, fast, useful, confident"
    },
    narration: [
      {
        id: "seg_001_para_001",
        segment_id: "seg_001",
        text: "OpenAI posted an official developer update.",
        estimated_seconds: 6,
        claim_ids: ["claim_001"],
        shot_ids: ["shot_001"]
      }
    ]
  },
  shotlist: {
    schema_version: "0.1.0",
    shots: [
      {
        id: "shot_001",
        segment_id: "seg_001",
        type: "source_screenshot",
        duration_seconds: 6,
        source_url: "https://openai.com/news/",
        highlight_text: "developer update",
        fallback: { type: "headline_card", card_text: "Official developer update" },
        asset_path: "assets/cards/shot_001.png",
        status: "fallback_generated"
      }
    ]
  },
  sources: {
    schema_version: "0.1.0",
    claims: [
      {
        id: "claim_001",
        text: "OpenAI posted an official developer update.",
        source_ids: ["source_001"],
        verification_status: "verified",
        risk_notes: []
      }
    ],
    sources: [
      {
        id: "source_001",
        url: "https://openai.com/news/",
        title: "OpenAI News",
        publisher: "OpenAI",
        source_type: "official",
        accessed_at: "2026-07-09T09:00:00-04:00"
      }
    ]
  },
  metadata: {
    schema_version: "0.1.0",
    youtube: {
      title: "Today in AI",
      description: "Fixture briefing.",
      tags: ["AI news"],
      categoryId: "28",
      privacyStatus: "private",
      madeForKids: false,
      containsSyntheticMedia: true
    },
    thumbnail: {
      brief: "AIMH branded AI news thumbnail.",
      text_options: ["Today in AI"]
    }
  }
});

describe("package QA", () => {
  it("passes a package where every claim and narration paragraph is covered", () => {
    const report = runPackageQa(validPackage());
    expect(report.ok).toBe(true);
    expect(report.checks.every((check) => check.pass)).toBe(true);
  });

  it("fails when narration has no visual", () => {
    const pkg = validPackage();
    pkg.script.narration[0]!.shot_ids = [];
    const report = runPackageQa(pkg);

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "visual_coverage")?.pass).toBe(false);
  });

  it("fails when upload metadata is not private", () => {
    const pkg = validPackage();
    pkg.metadata.youtube.privacyStatus = "public" as "private";

    const report = runPackageQa(pkg);
    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === "private_upload_policy")?.pass).toBe(false);
  });
});
