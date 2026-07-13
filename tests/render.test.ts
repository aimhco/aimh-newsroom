import { describe, expect, it } from "vitest";
import { buildCaptionsSrt, formatSrtTime } from "../src/render/captions";
import { buildRenderPlan } from "../src/render/localFallbackRenderer";
import type { EpisodePackage } from "../src/types";

const pkg = (): EpisodePackage => ({
  episode: {
    schema_version: "0.1.0",
    episode_id: "episode",
    date: "2026-07-09",
    timezone: "America/New_York",
    title: "Today in AI",
    description: "Preview.",
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
    voice: { provider: "placeholder", voice_id_env: "ELEVENLABS_VOICE_ID", style: "clear" },
    narration: [
      {
        id: "para_001",
        segment_id: "seg_001",
        text: "First line.",
        estimated_seconds: 2,
        claim_ids: ["claim_001"],
        shot_ids: ["shot_001"]
      },
      {
        id: "para_002",
        segment_id: "seg_002",
        text: "Second line.",
        estimated_seconds: 3,
        claim_ids: ["claim_002"],
        shot_ids: ["shot_002"]
      }
    ]
  },
  shotlist: {
    schema_version: "0.1.0",
    shots: [
      {
        id: "shot_001",
        segment_id: "seg_001",
        type: "headline_card",
        duration_seconds: 2,
        fallback: { type: "headline_card", card_text: "First" },
        asset_path: "assets/cards/shot_001.png",
        status: "fallback_generated"
      },
      {
        id: "shot_002",
        segment_id: "seg_002",
        type: "source_screenshot",
        duration_seconds: 3,
        fallback: { type: "source_screenshot", card_text: "Second" },
        asset_path: "assets/cards/shot_002.png",
        status: "fallback_generated"
      }
    ]
  },
  sources: { schema_version: "0.1.0", claims: [], sources: [] },
  metadata: {
    schema_version: "0.1.0",
    youtube: {
      title: "Today in AI",
      description: "Preview.",
      tags: [],
      categoryId: "28",
      privacyStatus: "private",
      madeForKids: false,
      containsSyntheticMedia: true
    },
    thumbnail: { brief: "brief", text_options: [] }
  }
});

describe("local fallback renderer planning", () => {
  it("formats SRT timestamps", () => {
    expect(formatSrtTime(65.432)).toBe("00:01:05,432");
  });

  it("builds captions from narration durations", () => {
    const srt = buildCaptionsSrt(pkg().script.narration, [2, 3]);

    expect(srt).toContain("00:00:00,000 --> 00:00:02,000");
    expect(srt).toContain("00:00:02,000 --> 00:00:05,000");
    expect(srt).toContain("Second line.");
  });

  it("maps narration paragraphs to visual assets and output segment paths", () => {
    const plan = buildRenderPlan({
      episodeDir: "/tmp/episode",
      package: pkg(),
      audioFiles: ["/tmp/episode/voice/para_001.mp3", "/tmp/episode/voice/para_002.mp3"],
      durationsSeconds: [2.1, 3.2]
    });

    expect(plan.segments).toEqual([
      {
        id: "para_001",
        text: "First line.",
        imagePath: "/tmp/episode/assets/cards/shot_001.png",
        audioPath: "/tmp/episode/voice/para_001.mp3",
        durationSeconds: 2.1,
        outPath: "/tmp/episode/render/work/segment_001.mp4"
      },
      {
        id: "para_002",
        text: "Second line.",
        imagePath: "/tmp/episode/assets/cards/shot_002.png",
        audioPath: "/tmp/episode/voice/para_002.mp3",
        durationSeconds: 3.2,
        outPath: "/tmp/episode/render/work/segment_002.mp4"
      }
    ]);
  });
});
