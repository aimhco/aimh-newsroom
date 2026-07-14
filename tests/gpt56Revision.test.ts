import { describe, expect, it } from "vitest";
import {
  allocateBeatFrames,
  GPT56_REVISION,
  parseGpt56RevisionCommand,
  SUPPORTED_GPT56_REVISION_COMMANDS,
  validateGpt56Revision
} from "../src/production/gpt56Revision";

describe("GPT-5.6 two-cut revision", () => {
  it("defines evidence and demo variants using the top film and live Saltwind", () => {
    expect(() => validateGpt56Revision(GPT56_REVISION)).not.toThrow();
    expect(GPT56_REVISION.variants.map((variant) => variant.id)).toEqual([
      "a-evidence",
      "b-demo"
    ]);

    for (const variant of GPT56_REVISION.variants) {
      const beats = variant.scenes.flatMap((scene) => scene.beats);
      expect(
        beats.some((beat) => beat.assetPath.endsWith("openai-hero-excerpt.mp4"))
      ).toBe(true);
      expect(
        beats.some(
          (beat) =>
            beat.kind === "interactive_capture" && beat.assetPath.includes("saltwind")
        )
      ).toBe(true);
      expect(
        beats.some(
          (beat) => beat.kind === "video" && beat.assetPath.includes("spirograph")
        )
      ).toBe(true);
    }
  });

  it("uses readable zooms and materially selected independent evidence", () => {
    const evidenceVariant = GPT56_REVISION.variants[0]!;
    const beats = evidenceVariant.scenes.flatMap((scene) => scene.beats);

    expect(beats.some((beat) => beat.kind === "source_zoom")).toBe(true);
    expect(beats.some((beat) => beat.assetPath.includes("coderabbit"))).toBe(true);
    expect(beats.some((beat) => beat.assetPath.includes("axios"))).toBe(true);
  });

  it("phrase-locks Programmatic Tool Calling in both scripts", () => {
    for (const variant of GPT56_REVISION.variants) {
      const practical = variant.script.narration.find((paragraph) =>
        paragraph.text.includes("Programmatic Tool Calling")
      );
      expect(practical?.speech_text).toContain("tool-calling");
      expect(practical?.critical_phrases).toContain("Programmatic Tool Calling");
    }
  });

  it("allocates exact integer beat frames from editorial weights", () => {
    expect(allocateBeatFrames(101, [{ weight: 1 }, { weight: 2 }, { weight: 1 }])).toEqual([
      25,
      51,
      25
    ]);
    expect(() => allocateBeatFrames(3, [{ weight: 1 }, { weight: 1 }, { weight: 1 }, { weight: 1 }]))
      .toThrow(/at least one frame/);
  });

  it("exposes no upload command", () => {
    expect(SUPPORTED_GPT56_REVISION_COMMANDS).toEqual(["voice", "render", "qa", "all"]);
    expect(() => parseGpt56RevisionCommand("upload")).toThrow(/Unsupported/);
  });
});
