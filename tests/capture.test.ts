import { describe, expect, it } from "vitest";
import {
  applyCaptureResults,
  buildCaptureTargets,
  captureSourceScreenshots,
  isBlockedCapturePage
} from "../src/capture/sourceScreenshotCapture";
import { isAllowedCaptureUrl } from "../src/config/allowlist";
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
    narration: []
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
        fallback: { type: "headline_card", card_text: "OpenAI source" },
        asset_path: "assets/cards/shot_001.png",
        status: "fallback_generated"
      },
      {
        id: "shot_002",
        segment_id: "seg_002",
        type: "social_card",
        duration_seconds: 6,
        source_url: "https://news.ycombinator.com/",
        fallback: { type: "social_card", card_text: "HN context" },
        asset_path: "assets/cards/shot_002.png",
        status: "fallback_generated"
      }
    ]
  },
  sources: {
    schema_version: "0.1.0",
    claims: [],
    sources: [
      {
        id: "source_001",
        url: "https://openai.com/news/",
        title: "OpenAI News",
        publisher: "OpenAI",
        source_type: "official",
        accessed_at: "2026-07-09T09:00:00-04:00"
      },
      {
        id: "source_002",
        url: "https://news.ycombinator.com/",
        title: "HN",
        publisher: "Hacker News",
        source_type: "social",
        accessed_at: "2026-07-09T09:00:00-04:00"
      }
    ]
  },
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

describe("source screenshot capture planning", () => {
  it("allows known public source domains and rejects unknown domains", () => {
    expect(isAllowedCaptureUrl("https://openai.com/news/")).toBe(true);
    expect(isAllowedCaptureUrl("https://subdomain.openai.com/path")).toBe(true);
    expect(isAllowedCaptureUrl("https://example.invalid/news")).toBe(false);
  });

  it("targets official source screenshots and skips social/context shots", () => {
    expect(buildCaptureTargets("/tmp/episode", pkg())).toEqual([
      {
        shotId: "shot_001",
        url: "https://openai.com/news/",
        outPath: "/tmp/episode/assets/screenshots/shot_001.png",
        assetPath: "assets/screenshots/shot_001.png"
      }
    ]);
  });

  it("updates shotlist assets after successful captures", () => {
    const episodePackage = pkg();
    const summary = applyCaptureResults(episodePackage, [
      {
        shotId: "shot_001",
        url: "https://openai.com/news/",
        ok: true,
        assetPath: "assets/screenshots/shot_001.png",
        outPath: "/tmp/episode/assets/screenshots/shot_001.png"
      }
    ]);

    expect(summary.captured).toBe(1);
    expect(episodePackage.shotlist.shots[0]?.asset_path).toBe("assets/screenshots/shot_001.png");
    expect(episodePackage.shotlist.shots[0]?.status).toBe("captured");
    expect(episodePackage.shotlist.shots[1]?.asset_path).toBe("assets/cards/shot_002.png");
  });

  it("detects challenge pages that should use fallback visuals", () => {
    expect(isBlockedCapturePage("Just a moment...", "Verifying... Cloudflare Privacy Help")).toBe(true);
    expect(isBlockedCapturePage("OpenAI News", "Latest updates from OpenAI")).toBe(false);
  });

  it("records failed capture results instead of throwing when the browser cannot launch", async () => {
    const episodePackage = pkg();
    const summary = await captureSourceScreenshots({
      episodeDir: "/tmp/episode",
      package: episodePackage,
      launchBrowser: async () => {
        throw new Error("missing browser");
      }
    });

    expect(summary).toMatchObject({ attempted: 1, captured: 0, failed: 1 });
    expect(summary.results[0]?.error).toContain("missing browser");
    expect(episodePackage.shotlist.shots[0]?.status).toBe("fallback_generated");
  });
});
