import { describe, expect, it } from "vitest";
import {
  allocateBeatFrames,
  buildRevisionPlateJobs,
  buildRevisionSceneWindows,
  GPT56_REVISION,
  parseGpt56RevisionCommand,
  SUPPORTED_GPT56_REVISION_COMMANDS,
  revisionPaths,
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
    expect(beats.some((beat) => beat.assetPath.includes("simon-willison"))).toBe(true);
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

  it("builds duration-bound plate jobs whose beat frames exactly fill each narration chunk", () => {
    const variant = GPT56_REVISION.variants[0]!;
    const voice = variant.script.narration.map((paragraph, index) => ({
      id: paragraph.id,
      text: paragraph.text,
      file: `/voice/${paragraph.id}.mp3`,
      durationSeconds: 10 + index,
      provider: "elevenlabs" as const,
      cached: false
    }));

    const jobs = buildRevisionPlateJobs(variant, voice, "/episode");

    expect(jobs).toHaveLength(variant.script.narration.length);
    for (const job of jobs) {
      expect(job.inputProps.beats.reduce((sum, beat) => sum + beat.durationFrames, 0)).toBe(
        Math.ceil(job.durationSeconds * 30)
      );
      expect(job.narrationPath).toMatch(/^\/voice\//);
      expect(job.outputPath).toContain("/render/revision/a-evidence/plates/");
    }
  });

  it("keeps baseline and final variant outputs at separate stable paths", () => {
    const paths = revisionPaths("/episode", "b-demo");

    expect(paths.baselineVideo).toBe("/episode/render/final-baseline.mp4");
    expect(paths.finalVideo).toBe("/episode/render/final-b-demo.mp4");
    expect(paths.variantRoot).toBe("/episode/render/revision/b-demo");
    expect(paths.script).toBe("/episode/script-b.json");
  });

  it("builds contiguous scene and beat windows for targeted media QA", () => {
    const variant = GPT56_REVISION.variants[1]!;
    const voice = variant.script.narration.map((paragraph) => ({
      id: paragraph.id,
      text: paragraph.text,
      file: `/voice/${paragraph.id}.mp3`,
      durationSeconds: 10,
      provider: "elevenlabs" as const,
      cached: false
    }));

    const windows = buildRevisionSceneWindows(variant, voice);

    expect(windows[0]).toMatchObject({ narrationId: "b_launch", startSeconds: 0, endSeconds: 10 });
    expect(windows.at(-1)).toMatchObject({ narrationId: "b_takeaway", startSeconds: 80, endSeconds: 90 });
    expect(windows.flatMap((scene) => scene.beats).some((beat) => beat.id === "saltwind-gameplay"))
      .toBe(true);
    for (const [index, scene] of windows.entries()) {
      expect(scene.beats[0]?.startSeconds).toBeCloseTo(scene.startSeconds, 6);
      expect(scene.beats.at(-1)?.endSeconds).toBeCloseTo(scene.endSeconds, 6);
      if (index > 0) expect(scene.startSeconds).toBeCloseTo(windows[index - 1]!.endSeconds, 6);
    }
  });
});
