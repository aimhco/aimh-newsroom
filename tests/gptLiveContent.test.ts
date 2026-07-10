import { describe, expect, it } from "vitest";
import { GPT_LIVE_CONTENT, GPT_LIVE_TIMELINE } from "../src/production/gptLive/content";

describe("GPT-Live controlled production content", () => {
  it("defines the two production variants", () => {
    expect(GPT_LIVE_CONTENT.variants).toEqual(["dynamic_editorial", "aimh_visual_host"]);
  });

  it("uses the controlled timeline order", () => {
    expect(GPT_LIVE_TIMELINE.map(({ kind }) => kind)).toEqual([
      "source_clip",
      "narration",
      "source_clip",
      "narration",
      "narration",
      "narration",
      "narration",
      "narration",
      "narration"
    ]);
    expect(GPT_LIVE_CONTENT.timeline).toBe(GPT_LIVE_TIMELINE);
  });

  it("defines the exact source clips", () => {
    const sourceClips = GPT_LIVE_TIMELINE.filter(({ kind }) => kind === "source_clip");

    expect(sourceClips).toEqual([
      {
        id: "clip_translation",
        kind: "source_clip",
        playerConfigUrl: "https://player.vimeo.com/video/1208096618/config?h=c7dd7ef278",
        startSeconds: 50.82,
        endSeconds: 63.17,
        sourceId: "src_openai_article"
      },
      {
        id: "clip_interruption",
        kind: "source_clip",
        playerConfigUrl: "https://player.vimeo.com/video/1208152658/config?h=c944a411bd",
        startSeconds: 31.96,
        endSeconds: 43.92,
        sourceId: "src_openai_article"
      }
    ]);
  });

  it("uses the controlled branding dimensions", () => {
    expect(GPT_LIVE_CONTENT.branding).toMatchObject({
      width: 150,
      marginTop: 24,
      marginRight: 24,
      opacity: 0.85
    });
  });

  it("maps every claim to known sources", () => {
    const sourceIds = new Set(GPT_LIVE_CONTENT.sources.map(({ id }) => id));

    for (const claim of GPT_LIVE_CONTENT.claims) {
      expect(claim.sourceIds.length, `${claim.id} must cite at least one source`).toBeGreaterThan(0);
      for (const sourceId of claim.sourceIds) {
        expect(sourceIds.has(sourceId), `${claim.id} cites unknown source ${sourceId}`).toBe(true);
      }
    }
  });

  it("ends with the exact audience prompt", () => {
    expect(GPT_LIVE_CONTENT.narration.at(-1)?.text).toContain(
      "tell me what GPT-Live enabled for you, or what you think it is going to enable for you"
    );
  });
});
